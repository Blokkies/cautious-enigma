import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { DEV_DEFAULT_ADMIN_PASSWORD, seedAdmin, type AdminStore } from "./admin-seed";

function memoryStore(initial: { name: string; password: string }[] = []) {
  const rows = initial.map((a, i) => ({ id: i + 1, name: a.name, passwordHash: bcrypt.hashSync(a.password, 4) }));
  const store: AdminStore = {
    count: async () => rows.length,
    list: async () => rows.map((r) => ({ ...r })),
    insert: async (name, passwordHash) => {
      rows.push({ id: rows.length + 1, name, passwordHash });
    },
    updateHash: async (id, passwordHash) => {
      rows.find((r) => r.id === id)!.passwordHash = passwordHash;
    },
  };
  const passwordOf = (name: string, candidate: string) => bcrypt.compareSync(candidate, rows.find((r) => r.name === name)!.passwordHash);
  return { store, rows, passwordOf };
}

const logger = () => ({ log: vi.fn(), warn: vi.fn() });

describe("seedAdmin", () => {
  it("production without ADMIN_PASSWORD seeds nothing and warns", async () => {
    const { store, rows } = memoryStore();
    const l = logger();
    await seedAdmin(store, { NODE_ENV: "production" }, l);
    expect(rows).toHaveLength(0);
    expect(l.warn).toHaveBeenCalledWith(expect.stringMatching(/ADMIN_PASSWORD is not set/));
  });

  it("development without ADMIN_PASSWORD seeds the default with a warning", async () => {
    const { store, rows, passwordOf } = memoryStore();
    const l = logger();
    await seedAdmin(store, { NODE_ENV: "development" }, l);
    expect(rows).toHaveLength(1);
    expect(passwordOf("Admin", DEV_DEFAULT_ADMIN_PASSWORD)).toBe(true);
    expect(l.warn).toHaveBeenCalled();
  });

  it("seeds ADMIN_PASSWORD on an empty table", async () => {
    const { store, passwordOf } = memoryStore();
    await seedAdmin(store, { NODE_ENV: "production", ADMIN_PASSWORD: "s3cret!" }, logger());
    expect(passwordOf("Admin", "s3cret!")).toBe(true);
  });

  it("replaces a lingering default password with ADMIN_PASSWORD, idempotently", async () => {
    const { store, passwordOf } = memoryStore([
      { name: "Admin", password: DEV_DEFAULT_ADMIN_PASSWORD },
      { name: "Other", password: "custom" },
    ]);
    const updateHash = vi.spyOn(store, "updateHash");
    const l = logger();
    await seedAdmin(store, { NODE_ENV: "production", ADMIN_PASSWORD: "s3cret!" }, l);
    expect(passwordOf("Admin", "s3cret!")).toBe(true);
    expect(passwordOf("Admin", DEV_DEFAULT_ADMIN_PASSWORD)).toBe(false);
    expect(passwordOf("Other", "custom")).toBe(true);
    expect(updateHash).toHaveBeenCalledTimes(1);
    expect(l.log).toHaveBeenCalledWith(expect.stringMatching(/'Admin' still had the default password/));

    // Second run: nothing left on the default, nothing changes
    await seedAdmin(store, { NODE_ENV: "production", ADMIN_PASSWORD: "s3cret!" }, l);
    expect(updateHash).toHaveBeenCalledTimes(1);
  });

  it("warns in production when an admin is still on the default and ADMIN_PASSWORD is unset", async () => {
    const { store, passwordOf } = memoryStore([{ name: "Admin", password: DEV_DEFAULT_ADMIN_PASSWORD }]);
    const l = logger();
    await seedAdmin(store, { NODE_ENV: "production" }, l);
    expect(passwordOf("Admin", DEV_DEFAULT_ADMIN_PASSWORD)).toBe(true);
    expect(l.warn).toHaveBeenCalledWith(expect.stringMatching(/'Admin' still uses the default admin password/));
  });
});
