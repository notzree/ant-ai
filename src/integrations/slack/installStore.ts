import {
  type Installation,
  type InstallationQuery,
  type InstallationStore,
  type Logger,
} from "@slack/oauth";
import db from "../../db/drizzle";
import { slackInstallations } from "../../db/schema/slack";
import { eq, and } from "drizzle-orm";

class PostgresInstallationStore implements InstallationStore {
  db = db;

  async storeInstallation<AuthVersion extends "v1" | "v2">(
    installation: Installation<AuthVersion, boolean>,
    logger?: Logger,
  ): Promise<void> {
    // Extract relevant data from installation
    const isEnterpriseInstall = installation.isEnterpriseInstall ?? false;
    const teamId = isEnterpriseInstall ? undefined : installation.team?.id;
    const enterpriseId = installation.enterprise?.id;
    const userId = installation.user.id;

    // Log installation process
    if (logger) {
      logger.debug(
        `Storing installation for ${isEnterpriseInstall ? "enterprise" : "team"} ${isEnterpriseInstall ? enterpriseId : teamId}`,
      );
    }

    // Prepare data for insertion/update
    const installationData = {
      teamId: teamId || null,
      enterpriseId: enterpriseId || null,
      userId,
      botToken: installation.bot?.token,
      botId: installation.bot?.id,
      botUserId: installation.bot?.userId,
      userToken: installation.user.token,
      isEnterpriseInstall,
      installedAt: new Date(),
      installationData: installation,
    };

    try {
      // Use a single upsert operation instead of checking and then updating/inserting
      await this.db
        .insert(slackInstallations)
        .values(installationData)
        .onConflictDoUpdate({
          // Target the unique constraint
          target:
            isEnterpriseInstall && enterpriseId
              ? [
                  slackInstallations.enterpriseId,
                  slackInstallations.isEnterpriseInstall,
                ]
              : [slackInstallations.teamId],
          // Set values to update
          set: installationData,
          // Make sure we're matching the correct record
          where:
            isEnterpriseInstall && enterpriseId
              ? and(
                  eq(slackInstallations.enterpriseId, enterpriseId),
                  eq(slackInstallations.isEnterpriseInstall, true),
                )
              : teamId
                ? eq(slackInstallations.teamId, teamId)
                : eq(slackInstallations.userId, userId),
        });

      if (logger) {
        logger.debug(`Upserted installation successfully`);
      }
    } catch (error) {
      if (logger) {
        logger.error(`Failed to store installation: ${error}`);
      }
      throw error;
    }
  }

  async fetchInstallation(
    query: InstallationQuery<boolean>,
    logger?: Logger,
  ): Promise<Installation<"v1" | "v2", boolean>> {
    const { teamId, enterpriseId, userId, isEnterpriseInstall } = query;

    if (logger) {
      logger.debug(
        `Fetching installation for ${isEnterpriseInstall ? "enterprise" : "team"} ${isEnterpriseInstall ? enterpriseId : teamId}`,
      );
    }

    try {
      const installation = await this.db.query.slackInstallations.findFirst({
        where: (fields, { and, eq, isNull, or }) => {
          const conditions = [];

          if (isEnterpriseInstall && enterpriseId) {
            conditions.push(
              and(
                eq(fields.enterpriseId, enterpriseId),
                eq(fields.isEnterpriseInstall, true),
              ),
            );
          } else if (teamId) {
            conditions.push(eq(fields.teamId, teamId));
          }

          if (userId) {
            conditions.push(eq(fields.userId, userId));
          }

          return and(...conditions);
        },
      });

      if (!installation) {
        const error = new Error(
          `No installation found for ${isEnterpriseInstall ? "enterprise" : "team"} ${isEnterpriseInstall ? enterpriseId : teamId}`,
        );
        if (logger) {
          logger.error(error.message);
        }
        throw error;
      }

      // Return the full installation data from the JSON field
      return installation.installationData as Installation<
        "v1" | "v2",
        boolean
      >;
    } catch (error) {
      if (logger) {
        logger.error(`Failed to fetch installation: ${error}`);
      }
      throw error;
    }
  }

  async deleteInstallation(
    query: InstallationQuery<boolean>,
    logger?: Logger,
  ): Promise<void> {
    const { teamId, enterpriseId, userId, isEnterpriseInstall } = query;

    if (logger) {
      logger.debug(
        `Deleting installation for ${isEnterpriseInstall ? "enterprise" : "team"} ${isEnterpriseInstall ? enterpriseId : teamId}`,
      );
    }

    try {
      // Use straightforward conditions for the delete operation
      let deleteCondition;

      if (isEnterpriseInstall && enterpriseId) {
        deleteCondition = and(
          eq(slackInstallations.enterpriseId, enterpriseId),
          eq(slackInstallations.isEnterpriseInstall, true),
        );
      } else if (teamId) {
        deleteCondition = eq(slackInstallations.teamId, teamId);
      } else if (userId) {
        deleteCondition = eq(slackInstallations.userId, userId);
      } else {
        throw new Error(
          "Invalid query: At least one of teamId, enterpriseId, or userId must be provided",
        );
      }

      await this.db.delete(slackInstallations).where(deleteCondition);

      if (logger) {
        logger.debug("Installation deleted successfully");
      }
    } catch (error) {
      if (logger) {
        logger.error(`Failed to delete installation: ${error}`);
      }
      throw error;
    }
  }
}

export default PostgresInstallationStore;
