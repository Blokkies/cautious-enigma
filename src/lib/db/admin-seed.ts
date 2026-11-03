import bcrypt from "bcryptjs";

/** Development-only default admin password (matches the admin-login bootstrap fallback). */
export const DEV_DEFAULT_ADMIN_PASSWORD = "admin2026";

/** The admins-table operations the seed needs (kept abstract so it can be unit tested). */
export interface AdminStore {
  count(): Promise<number>;
  list(): Promise<{ id: number; name: string; passwordHash: string }[]>;
  insert(name: string, passwordHash: string): Promise<void>;
  updateHash(id: number, passwordHash: string): Promise<void>;
}

export interface AdminSeedEnv {
  ADMIN_PASSWORD?: string;
  NODE_ENV?: string;
}

export interface AdminSeedLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * Seed / repair the admin account at migration time. Idempotent:
 * - Empty admins table: seed "Admin" with ADMIN_PASSWORD. Without ADMIN_PASSWORD, development
 *   falls back to the default password; production seeds nothing and warns instead.
 * - ADMIN_PASSWORD set: any admin whose password is still the development default gets
 *   ADMIN_PASSWORD instead (so a default seeded before the variable was set doesn't stick).
 *   Later runs find no such admin and change nothing.
 * - Production without ADMIN_PASSWORD: warns about admins still on the default password.
 */
export async function seedAdmin(store: AdminStore, env: AdminSeedEnv, logger: AdminSeedLogger = console): Promise<void> {
  const password = env.ADMIN_PASSWORD ? env.ADMIN_PASSWORD : null;
  const production = env.NODE_ENV === "production";

  if ((await store.count()) === 0) {
    if (password) {
      await store.insert("Admin", bcrypt.hashSync(password, 10));
      logger.log("Default admin seeded (name: Admin) with ADMIN_PASSWORD");
    } else if (!production) {
      await store.insert("Admin", bcrypt.hashSync(DEV_DEFAULT_ADMIN_PASSWORD, 10));
      logger.warn(
        "[SECURITY] ADMIN_PASSWORD not set: seeded admin 'Admin' with the development default password. Set ADMIN_PASSWORD before deploying."
      );
    } else {
      logger.warn(
        "[SECURITY] No admin account exists and ADMIN_PASSWORD is not set, so none was seeded. Set ADMIN_PASSWORD and re-run the migration (or log in once with it) to create the first admin."
      );
    }
    return;
  }

  if (password === DEV_DEFAULT_ADMIN_PASSWORD) return;

  const onDefault = (await store.list()).filter((a) => bcrypt.compareSync(DEV_DEFAULT_ADMIN_PASSWORD, a.passwordHash));
  if (onDefault.length === 0) return;

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    for (const admin of onDefault) {
      await store.updateHash(admin.id, hash);
      logger.log(`[SECURITY] Admin '${admin.name}' still had the default password; it now uses ADMIN_PASSWORD.`);
    }
  } else if (production) {
    logger.warn(
      `[SECURITY] ${onDefault.map((a) => `'${a.name}'`).join(", ")} still use${onDefault.length === 1 ? "s" : ""} the default admin password. Set ADMIN_PASSWORD and re-run the migration, or change the password in Settings.`
    );
  }
}
