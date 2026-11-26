import { ROLES } from "@devtools/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fail, type AppContext } from "../app";
import { hashPassword, tempPassword } from "../security";
import { parseRoles } from "../store";

const roles = z.array(z.enum(ROLES)).min(1);

export function memberRoutes(app: FastifyInstance, { store, touchMember }: AppContext) {
  app.get("/api/members", async () => ({ members: store.memberViews() }));

  // No upper limit on team size (REQ-ADM-007).
  app.post("/api/members", async (req, reply) => {
    if (!parseRoles(req.member.roles).includes("admin")) return fail(reply, 403, "admin_only");
    const body = z
      .object({ loginId: z.string().regex(/^[a-zA-Z0-9._-]{2,40}$/), name: z.string().min(1).max(60), roles })
      .safeParse(req.body);
    if (!body.success) return fail(reply, 400, "invalid_request");
    if (store.memberByLoginId(body.data.loginId)) return fail(reply, 409, "login_id_taken");
    const password = tempPassword();
    const member = store.createMember({
      loginId: body.data.loginId,
      name: body.data.name.trim(),
      passwordHash: await hashPassword(password),
      roles: body.data.roles,
      mustChangePassword: true,
    });
    touchMember(member.id, true);
    return reply.code(201).send({ member: store.memberView(member.id), tempPassword: password });
  });

  app.patch("/api/members/:id", async (req, reply) => {
    if (!parseRoles(req.member.roles).includes("admin")) return fail(reply, 403, "admin_only");
    const id = Number((req.params as { id: string }).id);
    const target = store.memberById(id);
    if (!target) return fail(reply, 404, "not_found");
    const body = z
      .object({
        name: z.string().min(1).max(60).optional(),
        roles: roles.optional(),
        active: z.boolean().optional(),
        resetPassword: z.literal(true).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return fail(reply, 400, "invalid_request");
    const patch = body.data;

    const losesAdmin = patch.active === false || (patch.roles !== undefined && !patch.roles.includes("admin"));
    if (losesAdmin && parseRoles(target.roles).includes("admin") && store.activeAdminCount(id) === 0) {
      return fail(reply, 409, "last_admin");
    }

    let password: string | undefined;
    if (patch.resetPassword) password = tempPassword();
    store.updateMember(id, {
      name: patch.name?.trim(),
      roles: patch.roles,
      active: patch.active,
      ...(password ? { passwordHash: await hashPassword(password), mustChangePassword: true } : {}),
    });
    // A resting member, or one whose password was reset, is signed out everywhere (REQ-ADM-008).
    if (patch.active === false || password) store.revokeAccess(id);
    touchMember(id, true);
    return { member: store.memberView(id), ...(password ? { tempPassword: password } : {}) };
  });
}
