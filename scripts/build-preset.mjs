/**
 * Builds the importable SillyTavern preset from presets/*.txt.
 * Run: node scripts/build-preset.mjs
 *
 * Output: presets/DS-Bridge-NSFW.json
 * Import in SillyTavern via Chat Completion settings -> Preset -> Import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PRESETS = path.join(ROOT, 'presets');

const read = name => fs.readFileSync(path.join(PRESETS, name), 'utf8').trim();

const core = read('core-nsfw.txt');
const scene = read('scene-nsfw.txt');

/**
 * Prompt block order mirrors SillyTavern's default preset so the import
 * slots in without breaking the existing prompt manager.
 */
const prompts = [
  {
    name: 'Main Prompt',
    system_prompt: true,
    role: 'system',
    content: core,
    identifier: 'main',
    injection_position: 0,
    injection_depth: 4,
    forbid_overrides: false,
    marker: false,
  },
  {
    name: 'Auxiliary Prompt',
    system_prompt: true,
    role: 'system',
    content: scene,
    identifier: 'nsfw',
    injection_position: 0,
    injection_depth: 4,
    forbid_overrides: false,
    marker: false,
  },
  {
    identifier: 'dialogueExamples',
    name: 'Chat Examples',
    system_prompt: true,
    marker: true,
  },
  {
    name: 'Post-History Instructions',
    system_prompt: true,
    role: 'system',
    content: '[Write only {{char}}\'s next reply. Continue the scene from the exact moment it stopped — no time skip, no summary, no commentary.]',
    identifier: 'jailbreak',
    marker: false,
  },
  {
    identifier: 'chatHistory',
    name: 'Chat History',
    system_prompt: true,
    marker: true,
  },
  {
    identifier: 'worldInfoAfter',
    name: 'World Info (after)',
    system_prompt: true,
    marker: true,
  },
  {
    identifier: 'worldInfoBefore',
    name: 'World Info (before)',
    system_prompt: true,
    marker: true,
  },
  {
    identifier: 'enhanceDefinitions',
    role: 'system',
    name: 'Enhance Definitions',
    content: 'Use the character sheet as the absolute authority on {{char}}. Add texture, not contradiction.',
    system_prompt: true,
    marker: false,
  },
  {
    identifier: 'charDescription',
    name: 'Char Description',
    system_prompt: true,
    marker: true,
  },
  {
    identifier: 'charPersonality',
    name: 'Char Personality',
    system_prompt: true,
    marker: true,
  },
  {
    identifier: 'scenario',
    name: 'Scenario',
    system_prompt: true,
    marker: true,
  },
  {
    identifier: 'personaDescription',
    name: 'Persona Description',
    system_prompt: true,
    marker: true,
  },
];

// Same identifiers in both orders so solo chats and group chats behave alike.
const order = {
  character_id: 100000,
  order: [
    { identifier: 'main', enabled: true },
    { identifier: 'worldInfoBefore', enabled: true },
    { identifier: 'charDescription', enabled: true },
    { identifier: 'charPersonality', enabled: true },
    { identifier: 'scenario', enabled: true },
    { identifier: 'enhanceDefinitions', enabled: false },
    { identifier: 'personaDescription', enabled: true },
    { identifier: 'nsfw', enabled: true },
    { identifier: 'worldInfoAfter', enabled: true },
    { identifier: 'dialogueExamples', enabled: true },
    { identifier: 'chatHistory', enabled: true },
    { identifier: 'jailbreak', enabled: true },
  ],
};

const preset = {
  // Point the preset at the local bridge so import alone configures the endpoint.
  chat_completion_source: 'custom',
  custom_url: 'http://127.0.0.1:8788/v1',
  custom_model: 'deepseek-web',
  custom_include_body: '',
  custom_exclude_body: '',
  custom_include_headers: '',

  temperature: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  top_p: 0.95,
  top_k: 0,
  top_a: 0,
  min_p: 0,
  repetition_penalty: 1,
  openai_max_context: 64000,
  openai_max_tokens: 1200,
  names_behavior: 0,
  send_if_empty: '',
  impersonation_prompt: '[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don\'t write as {{char}} or system. Don\'t describe actions of {{char}}.]',
  new_chat_prompt: '[Start a new Chat]',
  new_group_chat_prompt: '[Start a new group chat. Group members: {{group}}]',
  new_example_chat_prompt: '[Example Chat]',
  continue_nudge_prompt: '[Continue your last message without repeating its original content.]',
  bias_preset_selected: 'Default (none)',
  reverse_proxy: '',
  proxy_password: '',
  max_context_unlocked: true,
  wi_format: '{0}',
  scenario_format: '{{scenario}}',
  personality_format: '{{personality}}',
  group_nudge_prompt: '[Write the next reply only as {{char}}.]',
  stream_openai: true,
  prompts,
  prompt_order: [order, { ...order, character_id: 100001 }],
  show_external_models: false,
  assistant_prefill: '',
  assistant_impersonation: '',
  use_sysprompt: false,
  squash_system_messages: false,
  media_inlining: false,
  bypass_status_check: true,
  continue_prefill: false,
  continue_postfix: ' ',
  seed: -1,
  n: 1,
};

const out = path.join(PRESETS, 'DS-Bridge-NSFW.json');
fs.writeFileSync(out, JSON.stringify(preset, null, 2) + '\n', 'utf8');

// Fail loudly if the shape drifts from what SillyTavern expects.
const check = JSON.parse(fs.readFileSync(out, 'utf8'));
if (check.chat_completion_source !== 'custom') throw new Error('bad source');
if (!Array.isArray(check.prompts) || check.prompts.length !== prompts.length) throw new Error('prompt count');
if (!check.prompt_order[0].order.every(o => check.prompts.some(p => p.identifier === o.identifier))) {
  throw new Error('prompt_order references an unknown identifier');
}
if (!check.prompts.find(p => p.identifier === 'main').content.includes('{{char}}')) {
  throw new Error('main prompt lost its {{char}} placeholder');
}

console.log(`wrote ${path.relative(ROOT, out)}`);
console.log(`  prompts: ${check.prompts.length}`);
console.log(`  main prompt: ${check.prompts.find(p => p.identifier === 'main').content.length} chars`);
console.log(`  nsfw prompt: ${check.prompts.find(p => p.identifier === 'nsfw').content.length} chars`);
console.log(`  endpoint: ${check.custom_url} model=${check.custom_model}`);
