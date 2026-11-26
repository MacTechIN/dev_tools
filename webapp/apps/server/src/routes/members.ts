import { ROLES } from "@devtools/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fail, type AppContext } from "../app";
import { hashPassword, tempPassword } from "../security";
import { parseRoles } from "../store";

const roles = z.array(z.enum(ROLES)).min(1);
const name = z.string().trim().min(1).max(60);

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
}

export function memberRoutes(app: FastifyInstance, { store, touchMember }: AppContext) {
  app.get("/api/members", async () => ({ members: store.memberViews() }));

  // No upper limit on team size (REQ-ADM-007).
  app.post("/api/members", async (req, reply) => {
    if (!parseRoles(req.member.roles).includes("admin")) return fail(reply, 403, "admin_only");
    const body = z.object({ loginId: z.string().regex(/^[a-zA-Z0-9._-]{2,40}$/), name, roles }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "invalid_request");
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    // Checked after the await so the check and the insert run without a gap.
    if (store.memberByLoginId(body.data.loginId)) return fail(reply, 409, "login_id_taken");
    let id: number;
    try {
      id = store.createMember({ loginId: body.data.loginId, name: body.data.name, passwordHash, roles: body.data.roles, mustChangePassword: true }).id;
    } catch (e) {
      if (isUniqueViolation(e)) return fail(reply, 409, "login_id_taken");
      throw e;
    }
    touchMember(id, true);
    return reply.code(201).send({ member: store.memberView(id), tempPassword: password });
  });

  app.patch("/api/members/:id", async (req, reply) => {
    if (!parseRoles(req.member.roles).includes("admin")) return fail(reply, 403, "admin_only");
    const id = Number((req.params as { id: string }).id);
    const body = z
      .object({ name: name.optional(), roles: roles.optional(), active: z.boolean().optional(), resetPassword: z.literal(true).optional() })
      .safeParse(req.body);
    if (!body.success) return fail(reply, 400, "invalid_request");
    const patch = body.data;

    // Hash first: everything after this point is synchronous, so two concurrent
    // requests cannot both pass the last-admin check.
    const password = patch.resetPassword ? tempPassword() : undefined;
    const passwordHash = password ? await hashPassword(password) : undefined;

    const target = store.memberById(id);
    if (!target) return fail(reply, 404, "not_found");
    const losesAdmin = patch.active === false || (patch.roles !== undefined && !patch.roles.includes("admin"));
    if (losesAdmin && parseRoles(target.roles).includes("admin") && store.activeAdminCount(id) === 0) {
      return fail(reply, 409, "last_admin");
    }

    store.updateMember(id, {
      name: patch.name,
      roles: patch.roles,
      active: patch.active,
      ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
    });
    // A resting member, or one whose password was reset, is signed out everywhere (REQ-ADM-008).
    if (patch.active === false || password) store.revokeAccess(id);
    touchMember(id, true);
    return { member: store.memberView(id), ...(password ? { tempPassword: password } : {}) };
  });
}
