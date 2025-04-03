import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Custom user table that references Supabase auth.users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(), // This will map to auth.users(id)
  // Any additional fields you might want to include
});

// Slack installations table
export const slackInstallations = pgTable(
  "slack_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: text("team_id"),
    enterpriseId: text("enterprise_id"),
    userId: text("user_id").notNull(),
    botToken: text("bot_token"),
    botId: text("bot_id"),
    botUserId: text("bot_user_id"),
    userToken: text("user_token"),
    isEnterpriseInstall: boolean("is_enterprise_install").default(false),
    installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow(),
    installationData: jsonb("installation_data").notNull(),
  },
  (table) => {
    return {
      teamEnterpriseUnique: uniqueIndex("team_enterprise_unique_idx").on(
        table.teamId,
        table.enterpriseId,
      ),
      teamIdUnique: uniqueIndex("team_id_unique_idx").on(table.teamId),
      enterpriseInstallUnique: uniqueIndex("enterprise_install_unique_idx").on(
        table.enterpriseId,
        table.isEnterpriseInstall,
      ),
      teamIdIdx: index("idx_slack_installations_team_id").on(table.teamId),
      enterpriseIdIdx: index("idx_slack_installations_enterprise_id").on(
        table.enterpriseId,
      ),
      userIdIdx: index("idx_slack_installations_user_id").on(table.userId),
      hasTeamOrEnterprise: check(
        "has_team_or_enterprise",
        sql`(${table.teamId} IS NOT NULL) OR (${table.enterpriseId} IS NOT NULL)`,
      ),
    };
  },
);

// User-Slack installations link table
export const userSlackInstallations = pgTable(
  "user_slack_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    teamId: text("team_id"),
    enterpriseId: text("enterprise_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      userTeamEnterpriseUnique: uniqueIndex(
        "user_team_enterprise_unique_idx",
      ).on(table.userId, table.teamId, table.enterpriseId),
      userIdIdx: index("idx_user_slack_installations_user_id").on(table.userId),
      teamIdIdx: index("idx_user_slack_installations_team_id").on(table.teamId),
      enterpriseIdIdx: index("idx_user_slack_installations_enterprise_id").on(
        table.enterpriseId,
      ),
      hasTeamOrEnterprise: check(
        "has_team_or_enterprise",
        sql`(${table.teamId} IS NOT NULL) OR (${table.enterpriseId} IS NOT NULL)`,
      ),
    };
  },
);

// Define relations between tables
export const slackInstallationsRelations = relations(
  slackInstallations,
  ({ many }) => ({
    userSlackInstallations: many(userSlackInstallations),
  }),
);

export const userSlackInstallationsRelations = relations(
  userSlackInstallations,
  ({ one }) => ({
    user: one(users, {
      fields: [userSlackInstallations.userId],
      references: [users.id],
    }),
  }),
);
