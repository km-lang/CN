import { defineConfig } from "drizzle-kit";

// Separate history: never point the PostgreSQL generator at the D1 migrations.
// This Step 2 configuration is pinned to the isolated new-project branch.
const stagingHost = "ep-super-meadow-az4e41mn.c-3.ap-southeast-1.aws.neon.tech";
const directUrl = process.env.DATABASE_URL_UNPOOLED;
if (directUrl) {
  const target = new URL(directUrl);
  if (target.protocol !== "postgresql:" || target.hostname !== stagingHost || target.pathname !== "/corporate_network") {
    throw new Error("DATABASE_URL_UNPOOLED must target the cn-sabarinadh-staging direct endpoint and corporate_network database.");
  }
}

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/postgres/schema.ts",
  dialect: "postgresql",
  ...(directUrl
    ? { dbCredentials: { url: directUrl } }
    : {}),
});
