CREATE TABLE "slack_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" text,
	"enterprise_id" text,
	"user_id" text NOT NULL,
	"bot_token" text,
	"bot_id" text,
	"bot_user_id" text,
	"user_token" text,
	"is_enterprise_install" boolean DEFAULT false,
	"installed_at" timestamp with time zone DEFAULT now(),
	"installation_data" jsonb NOT NULL,
	CONSTRAINT "has_team_or_enterprise" CHECK (("slack_installations"."team_id" IS NOT NULL) OR ("slack_installations"."enterprise_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_slack_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"team_id" text,
	"enterprise_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "has_team_or_enterprise" CHECK (("user_slack_installations"."team_id" IS NOT NULL) OR ("user_slack_installations"."enterprise_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_slack_installations" ADD CONSTRAINT "user_slack_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_enterprise_unique_idx" ON "slack_installations" USING btree ("team_id","enterprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_id_unique_idx" ON "slack_installations" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_install_unique_idx" ON "slack_installations" USING btree ("enterprise_id","is_enterprise_install");--> statement-breakpoint
CREATE INDEX "idx_slack_installations_team_id" ON "slack_installations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_slack_installations_enterprise_id" ON "slack_installations" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "idx_slack_installations_user_id" ON "slack_installations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_team_enterprise_unique_idx" ON "user_slack_installations" USING btree ("user_id","team_id","enterprise_id");--> statement-breakpoint
CREATE INDEX "idx_user_slack_installations_user_id" ON "user_slack_installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_slack_installations_team_id" ON "user_slack_installations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_user_slack_installations_enterprise_id" ON "user_slack_installations" USING btree ("enterprise_id");