import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";

export const DynamoDB = new DynamoDBClient({ region: AWS_REGION });
