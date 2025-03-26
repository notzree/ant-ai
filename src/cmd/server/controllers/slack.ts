import { InstallProvider, LogLevel } from "@slack/oauth";
import type { Request, Response, NextFunction } from "express";
import { createEventAdapter, type SlackEventAdapter } from "@slack/events-api";
import PostgresInstallationStore from "../../../integrations/slack/installStore";

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

if (!SLACK_SIGNING_SECRET) {
  throw new Error("SLACK_SIGNING_SECRET is not set");
}

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
if (!SLACK_CLIENT_ID) {
  throw new Error("SLACK_CLIENT_ID is not set");
}

const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
if (!SLACK_CLIENT_SECRET) {
  throw new Error("SLACK_CLIENT_SECRET is not set");
}

class SlackController {
  private installer: InstallProvider;
  private scopes: Array<string>;
  private userScopes: Array<string>;
  private slackEvents: SlackEventAdapter;

  constructor(
    installer: InstallProvider,
    scopes: Array<string>,
    userScopes: Array<string>,
  ) {
    this.installer = installer;
    this.scopes = scopes;
    this.userScopes = userScopes;
    this.slackEvents = createEventAdapter(SLACK_SIGNING_SECRET as string, {
      includeBody: true,
    });
  }

  async handle_install(req: Request, res: Response, next: NextFunction) {
    try {
      this.installer.handleInstallPath(
        req,
        res,
        {},
        {
          scopes: this.scopes,
          userScopes: this.userScopes,
        },
      );
    } catch (error) {
      next(error);
    }
  }
  async handle_oauth_redirect(req: Request, res: Response, next: NextFunction) {
    try {
      this.installer.handleCallback(req, res);
    } catch (error) {
      next(error);
    }
  }
  async handle_events(req: Request, res: Response, next: NextFunction) {
    try {
      this.slackEvents.requestListener()(req, res);
    } catch (error) {
      next(error);
    }
  }
}

const scopes = [
  "app_mentions:read",
  "channels:read",
  "groups:read",
  "channels:manage",
  "chat:write",
  "incoming-webhook",
];
const userScopes = ["chat:write"];
const installer = new InstallProvider({
  clientId: SLACK_CLIENT_ID,
  clientSecret: SLACK_CLIENT_SECRET,
  authVersion: "v2",
  stateSecret: process.env.SLACK_STATE_SECRET,
  installationStore: new PostgresInstallationStore(),
  logLevel: LogLevel.DEBUG,
});
const SupabaseSlackController = new SlackController(
  installer,
  scopes,
  userScopes,
);
export default SupabaseSlackController;
