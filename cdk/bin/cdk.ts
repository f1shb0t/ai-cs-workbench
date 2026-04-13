#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AiCsWorkbenchStack } from '../lib/ai-cs-workbench-stack';
import * as fs from 'fs';
import * as path from 'path';

const configPath = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('ERROR: cdk/config.json not found. Copy config.example.json to config.json and fill in your values.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = new cdk.App();
const timestamp = Date.now().toString(36);
const stackName = config.stackName || `AiCsWorkbench-${timestamp}`;
const prefix = config.resourcePrefix || '';

new AiCsWorkbenchStack(app, stackName, {
  env: {
    region: config.awsRegion || 'us-west-2',
  },
  config: {
    prefix,
    knowledgeBaseId: config.knowledgeBaseId,
    modelId: config.modelId,
    systemPrompt: config.systemPrompt || '',
  },
});
