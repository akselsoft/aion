<template>
  <q-layout view="hHh Lpr fff">
    <q-header elevated class="topbar">
      <q-toolbar>
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="drawer = !drawer" />
        <q-toolbar-title>{{ $t('app.title') }}</q-toolbar-title>
        <q-chip dense square color="white" text-color="primary" icon="desktop_mac">{{ runtimeLabel }}</q-chip>
      </q-toolbar>
    </q-header>

    <q-drawer v-model="drawer" show-if-above bordered :width="300" class="side">
      <div class="brand-panel">
        <q-icon name="hub" size="34px" />
        <div>
          <strong>{{ $t('app.title') }}</strong>
          <span>{{ $t('app.subtitle') }}</span>
        </div>
      </div>

      <q-list padding>
        <q-item-label header>{{ $t('nav.workspace') }}</q-item-label>
        <q-item
          clickable
          :active="mode === 'configs'"
          active-class="active-nav"
          @click="selectMode('configs')"
        >
          <q-item-section avatar><q-icon name="account_tree" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ $t('nav.configs') }}</q-item-label>
            <q-item-label caption>{{ $t('nav.configsCaption') }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-item
          clickable
          :active="mode === 'watchers'"
          active-class="active-nav"
          @click="selectMode('watchers')"
        >
          <q-item-section avatar><q-icon name="schedule" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ $t('nav.watchers') }}</q-item-label>
            <q-item-label caption>{{ $t('nav.watchersCaption') }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>

      <q-separator />

      <div class="file-panel">
        <q-select
          v-model="selectedPath"
          :options="fileOptions"
          option-label="label"
          option-value="value"
          emit-value
          map-options
          dense
          outlined
          :label="mode === 'configs' ? $t('files.configFile') : $t('files.watchFile')"
          @update:model-value="loadSelectedFile"
        >
          <template #prepend>
            <q-icon :name="mode === 'configs' ? 'description' : 'event_note'" />
          </template>
        </q-select>

        <div class="row q-gutter-sm q-mt-md">
          <q-btn outline color="primary" icon="folder_open" :label="$t('actions.open')" no-caps @click="openLocalFile" />
          <q-btn outline color="primary" icon="refresh" :label="$t('actions.reload')" no-caps :disable="!selectedPath" @click="loadSelectedFile" />
          <q-btn color="positive" icon="save" :label="$t('actions.save')" no-caps :disable="!doc || !dirty" @click="saveFile" />
          <q-btn outline color="secondary" icon="translate" :label="$t('actions.loadLabels')" no-caps @click="openLanguageFile" />
        </div>
      </div>
    </q-drawer>

    <q-page-container>
      <q-page class="page">
        <div v-if="loading" class="center-state">
          <q-spinner color="primary" size="42px" />
        </div>

        <div v-else-if="!doc" class="empty-state">
          <q-icon name="folder_open" size="48px" />
          <div>{{ $t('files.selectPrompt') }}</div>
        </div>

        <template v-else>
          <section class="title-band">
            <div>
              <div class="eyebrow">{{ mode === 'configs' ? $t('meta.configuration') : $t('meta.watcher') }}</div>
              <h1>{{ selectedName }}</h1>
              <p>{{ selectedPath }}</p>
            </div>
            <div class="title-actions">
              <div class="summary-chips">
                <q-chip v-if="mode === 'configs'" dense square icon="input" color="white" text-color="primary">
                  {{ $t('summary.collectors', { count: configSummary.collectors }) }}
                </q-chip>
                <q-chip v-if="mode === 'configs'" dense square icon="psychology" color="white" text-color="primary">
                  {{ $t('summary.interpreters', { count: configSummary.interpreters }) }}
                </q-chip>
                <q-chip v-if="mode === 'configs'" dense square icon="outbox" color="white" text-color="primary">
                  {{ $t('summary.responders', { count: configSummary.responders }) }}
                </q-chip>
                <q-chip v-else dense square icon="event_repeat" color="white" text-color="primary">
                  {{ $t('summary.watchEntries', { count: watchEntries.length }) }}
                </q-chip>
                <q-chip v-if="dirty" dense square icon="edit" color="warning" text-color="dark">
                  {{ $t('summary.unsaved') }}
                </q-chip>
              </div>
              <q-btn outline color="primary" icon="data_object" :label="$t('actions.rawJson')" no-caps @click="rawOpen = true" />
              <q-btn
                v-if="mode === 'configs'"
                color="warning"
                text-color="dark"
                icon="play_arrow"
                :label="$t('actions.runTest')"
                no-caps
                @click="confirmRun"
              />
            </div>
          </section>

          <config-editor
            v-if="mode === 'configs'"
            :doc="doc"
            :engines="engines"
            @changed="dirty = true"
          />

          <watch-editor
            v-else
            :entries="watchEntries"
            @changed="dirty = true"
          />

          <section v-if="runOutput || runBusy" class="run-panel">
            <div class="run-header">
              <div>
                <div class="eyebrow">{{ $t('run.output') }}</div>
                <h2>{{ runBusy ? $t('run.running') : $t('run.exitCode', { code: runCode }) }}</h2>
              </div>
              <q-spinner v-if="runBusy" color="warning" />
            </div>
            <pre>{{ runOutput }}</pre>
          </section>
        </template>
      </q-page>
    </q-page-container>

    <q-dialog v-model="rawOpen" maximized>
      <q-card class="raw-dialog">
        <q-toolbar class="bg-primary text-white">
          <q-toolbar-title>{{ $t('actions.rawJson') }}</q-toolbar-title>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-toolbar>
        <q-card-section>
          <q-input v-model="rawText" type="textarea" autogrow outlined spellcheck="false" class="json-area" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('actions.cancel')" no-caps v-close-popup />
          <q-btn color="primary" :label="$t('actions.applyJson')" no-caps @click="applyRawJson" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script setup>
import { computed, defineComponent, onMounted, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { mergeLocaleOverrides } from './i18n';

const API = '';
const $q = useQuasar();
const { t, tm } = useI18n();
const runtimeLabel = computed(() => window.aionApi ? t('app.desktop') : t('app.browser'));

const drawer = ref(true);
const mode = ref('configs');
const files = ref([]);
const engines = ref([]);
const selectedPath = ref('');
const doc = ref(null);
const loading = ref(false);
const dirty = ref(false);
const rawOpen = ref(false);
const rawText = ref('');
const runBusy = ref(false);
const runOutput = ref('');
const runCode = ref(null);

const fileOptions = computed(() => files.value.map(file => ({
  label: file.path,
  value: file.path
})));

const watchEntries = computed(() => Array.isArray(doc.value) ? doc.value : []);
const selectedName = computed(() => selectedPath.value ? selectedPath.value.split('/').pop() : '');
const configSummary = computed(() => {
  if (!doc.value || Array.isArray(doc.value)) {
    return { collectors: 0, interpreters: 0, responders: 0 };
  }
  const params = ensureParams(doc.value);
  return {
    collectors: params.collectors.length,
    interpreters: params.interpreters.length,
    responders: params.responders.length
  };
});

watch(rawOpen, value => {
  if (value && doc.value) rawText.value = JSON.stringify(doc.value, null, 2);
});

onMounted(async () => {
  await Promise.all([loadEngines(), loadFiles()]);
});

async function request(path, options) {
  const res = await fetch(`${API}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

async function loadFiles() {
  loading.value = true;
  try {
    const kind = mode.value === 'configs' ? 'config' : 'watch';
    files.value = await listFiles(kind);
    selectedPath.value = files.value[0]?.path || '';
    if (selectedPath.value) await loadSelectedFile();
  } catch (err) {
    notifyError(err);
  } finally {
    loading.value = false;
  }
}

async function loadEngines() {
  try {
    engines.value = await listEngines();
  } catch (err) {
    notifyError(err);
  }
}

async function selectMode(nextMode) {
  mode.value = nextMode;
  doc.value = null;
  selectedPath.value = '';
  runOutput.value = '';
  await loadFiles();
}

async function loadSelectedFile() {
  if (!selectedPath.value) return;
  loading.value = true;
  try {
    const data = await readFile(selectedPath.value);
    doc.value = data.data;
    dirty.value = false;
  } catch (err) {
    notifyError(err);
  } finally {
    loading.value = false;
  }
}

async function saveFile() {
  try {
    await writeFile(selectedPath.value, cleanForSave(doc.value));
    dirty.value = false;
    $q.notify({ type: 'positive', message: t('notify.saved') });
  } catch (err) {
    notifyError(err);
  }
}

async function openLocalFile() {
  if (!window.aionApi?.openJsonFile) {
    $q.notify({ type: 'info', message: t('notify.desktopOpenOnly') });
    return;
  }
  try {
    const kind = mode.value === 'configs' ? 'config' : 'watch';
    const opened = await window.aionApi.openJsonFile(kind);
    if (!opened) return;
    selectedPath.value = opened.path;
    doc.value = opened.data;
    dirty.value = false;
    if (!files.value.some(file => file.path === opened.path)) {
      files.value.unshift({ path: opened.path, name: opened.path.split('/').pop(), kind });
    }
  } catch (err) {
    notifyError(err);
  }
}

async function openLanguageFile() {
  if (!window.aionApi?.openLanguageFile) {
    $q.notify({ type: 'info', message: t('notify.labelsDesktopOnly') });
    return;
  }
  try {
    const opened = await window.aionApi.openLanguageFile();
    if (!opened) return;
    mergeLocaleOverrides(opened.data);
    $q.notify({ type: 'positive', message: t('notify.labelsLoaded') });
  } catch (err) {
    notifyError(err);
  }
}

function applyRawJson() {
  try {
    doc.value = JSON.parse(rawText.value);
    dirty.value = true;
    rawOpen.value = false;
  } catch (err) {
    notifyError(err);
  }
}

function confirmRun() {
  $q.dialog({
    title: t('run.confirmTitle'),
    message: t('run.confirmMessage'),
    cancel: true,
    persistent: true,
    ok: { label: t('actions.runTest'), color: 'warning', textColor: 'dark', noCaps: true }
  }).onOk(runConfig);
}

async function runConfig() {
  runBusy.value = true;
  runOutput.value = '';
  runCode.value = null;
  try {
    const data = await runSelectedConfig(selectedPath.value);
    runOutput.value = data.output || '';
    runCode.value = data.code;
  } catch (err) {
    runOutput.value = err.message;
    runCode.value = 'error';
  } finally {
    runBusy.value = false;
  }
}

async function listFiles(kind) {
  if (window.aionApi) return window.aionApi.listFiles(kind);
  const data = await request(`/api/files?kind=${kind}`);
  return data.files || [];
}

async function listEngines() {
  if (window.aionApi) return window.aionApi.listEngines();
  const data = await request('/api/engines');
  return data.engines || [];
}

async function readFile(path) {
  if (window.aionApi) return window.aionApi.readFile(path);
  return request(`/api/file?path=${encodeURIComponent(path)}`);
}

async function writeFile(path, data) {
  if (window.aionApi) return window.aionApi.writeFile(path, data);
  return request('/api/file', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, data })
  });
}

async function runSelectedConfig(path) {
  if (window.aionApi) return window.aionApi.runConfig(path);
  return request('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path })
  });
}

function cleanForSave(value) {
  if (Array.isArray(value)) return value.map(cleanForSave);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key.startsWith('_ui')) continue;
      out[key] = cleanForSave(entry);
    }
    return out;
  }
  return value;
}

function notifyError(err) {
  $q.notify({ type: 'negative', message: err.message || String(err) });
}

function ensureParams(config) {
  if (!config.params || typeof config.params !== 'object') config.params = {};
  for (const phase of ['collectors', 'interpreters', 'responders']) {
    if (!Array.isArray(config.params[phase])) config.params[phase] = [];
  }
  return config.params;
}

function parseLoose(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function formatLoose(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function engineKey(value) {
  return String(value || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.js$/i, '');
}

function engineLabel(step) {
  const catalog = tm('engineCatalog') || {};
  const key = engineKey(step.engine);
  return catalog[key]?.label || step.engine || t('engine.noEngine');
}

function engineHelp(step) {
  const catalog = tm('engineCatalog') || {};
  return catalog[engineKey(step.engine)]?.help || '';
}

function paramLabel(step, key) {
  const catalog = tm('engineCatalog') || {};
  const specific = catalog[engineKey(step.engine)]?.params?.[key];
  const common = catalog.common?.params?.[key];
  return specific || common || humanizeKey(key);
}

function humanizeKey(key) {
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, char => char.toUpperCase());
}

const COMMON_KEYS = new Set(['engine', 'codeType', 'enabled', 'name', 'inputType', 'outputType']);

const EngineStep = defineComponent({
  name: 'EngineStep',
  props: {
    step: { type: Object, required: true },
    engines: { type: Array, required: true },
    index: { type: Number, required: true }
  },
  emits: ['changed', 'remove'],
  setup(props, { emit }) {
    const detailsOpen = ref(false);
    const newKey = ref('');
    const newValue = ref('');
    const drafts = reactive({});

    const engineOptions = computed(() => props.engines.map(engine => ({
      label: engine.label,
      value: engine.value
    })));

    const attrKeys = computed(() => Object.keys(props.step).filter(key => !COMMON_KEYS.has(key) && !key.startsWith('_ui')));

    function draftFor(key) {
      if (!(key in drafts)) drafts[key] = formatLoose(props.step[key]);
      return drafts[key];
    }

    function updateDraft(key, value) {
      drafts[key] = value;
    }

    function commit(key) {
      props.step[key] = parseLoose(drafts[key]);
      emit('changed');
    }

    function addAttribute() {
      const key = newKey.value.trim();
      if (!key) return;
      props.step[key] = parseLoose(newValue.value);
      drafts[key] = formatLoose(props.step[key]);
      newKey.value = '';
      newValue.value = '';
      emit('changed');
    }

    function removeAttribute(key) {
      delete props.step[key];
      delete drafts[key];
      emit('changed');
    }

    return {
      detailsOpen,
      engineOptions,
      attrKeys,
      newKey,
      newValue,
      engineLabel,
      engineHelp,
      paramLabel,
      draftFor,
      updateDraft,
      commit,
      addAttribute,
      removeAttribute
    };
  },
  template: `
    <q-card flat bordered class="engine-card" @click="detailsOpen = true">
      <div class="engine-title">
        <q-icon name="settings_input_component" />
        <div class="engine-summary">
          <strong>{{ step.name || $t('engine.unnamed') }}</strong>
          <span>{{ engineHelp(step) || engineLabel(step) }}</span>
        </div>
        <q-space />
        <q-chip dense square :color="step.enabled === false ? 'grey-4' : 'positive'" :text-color="step.enabled === false ? 'dark' : 'white'">
          {{ step.enabled === false ? $t('engine.disabled') : $t('engine.enabled') }}
        </q-chip>
        <q-btn flat round dense icon="edit" color="primary" @click.stop="detailsOpen = true">
          <q-tooltip>{{ $t('actions.editStep') }}</q-tooltip>
        </q-btn>
        <q-btn flat round dense icon="delete" color="negative" @click.stop="$emit('remove')">
          <q-tooltip>{{ $t('actions.removeStep') }}</q-tooltip>
        </q-btn>
      </div>

      <div class="engine-pills">
        <q-chip v-if="step.inputType" dense square icon="login">{{ step.inputType }}</q-chip>
        <q-chip v-if="step.outputType" dense square icon="logout">{{ step.outputType }}</q-chip>
        <q-chip v-if="step.codeType" dense square icon="code">{{ step.codeType }}</q-chip>
        <q-chip v-if="attrKeys.length" dense square icon="tune">{{ $t('engine.attrCount', { count: attrKeys.length }) }}</q-chip>
      </div>

      <q-dialog v-model="detailsOpen">
        <q-card class="engine-dialog" @click.stop>
          <q-card-section class="engine-dialog-head">
            <div>
              <div class="eyebrow">{{ $t('engine.parameters') }}</div>
              <h2>{{ step.name || $t('engine.unnamed') }}</h2>
              <p v-if="engineHelp(step)" class="engine-help">{{ engineHelp(step) }}</p>
              <p class="engine-raw">{{ $t('engine.rawEngine', { engine: step.engine || $t('engine.noEngine') }) }}</p>
            </div>
            <q-btn flat round dense icon="close" v-close-popup />
          </q-card-section>

          <q-card-section class="engine-fields">
            <q-input v-model="step.name" dense outlined :label="paramLabel(step, 'name')" @update:model-value="$emit('changed')" />
            <q-select
              v-model="step.engine"
              :options="engineOptions"
              emit-value
              map-options
              dense
              outlined
              :label="paramLabel(step, 'engine')"
              @update:model-value="$emit('changed')"
            />
            <q-toggle v-model="step.enabled" color="positive" :label="paramLabel(step, 'enabled')" @update:model-value="$emit('changed')" />
            <q-input v-model="step.codeType" dense outlined :label="paramLabel(step, 'codeType')" @update:model-value="$emit('changed')" />
            <q-input v-model="step.inputType" dense outlined :label="paramLabel(step, 'inputType')" @update:model-value="$emit('changed')" />
            <q-input v-model="step.outputType" dense outlined :label="paramLabel(step, 'outputType')" @update:model-value="$emit('changed')" />
          </q-card-section>

          <q-separator />

          <q-card-section>
            <div class="attr-heading">
              <div>
                <div class="eyebrow">{{ $t('engine.attributes') }}</div>
                <p>{{ $t('engine.attributesHelp') }}</p>
              </div>
            </div>

            <div v-if="!attrKeys.length" class="phase-empty">
              <q-icon name="tune" />
              <span>{{ $t('engine.noAttributes') }}</span>
            </div>

            <div v-for="key in attrKeys" :key="key" class="attr-row">
              <div class="attr-label">
                <strong>{{ paramLabel(step, key) }}</strong>
                <span>{{ $t('engine.rawKey', { key }) }}</span>
              </div>
              <q-input
                :model-value="draftFor(key)"
                dense
                outlined
                autogrow
                type="textarea"
                :label="$t('engine.value')"
                @update:model-value="updateDraft(key, $event)"
                @blur="commit(key)"
              />
              <q-btn flat dense round icon="close" color="negative" @click="removeAttribute(key)" />
            </div>

            <div class="attr-add">
              <q-input v-model="newKey" dense outlined :label="$t('engine.newAttribute')" />
              <q-input v-model="newValue" dense outlined :label="$t('engine.value')" @keyup.enter="addAttribute" />
              <q-btn color="primary" icon="add" :label="$t('actions.add')" no-caps @click="addAttribute" />
            </div>
          </q-card-section>

          <q-card-actions align="right">
            <q-btn flat :label="$t('actions.close')" no-caps v-close-popup />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </q-card>
  `
});

const ConfigEditor = defineComponent({
  name: 'ConfigEditor',
  components: { EngineStep },
  props: {
    doc: { type: Object, required: true },
    engines: { type: Array, required: true }
  },
  emits: ['changed'],
  setup(props, { emit }) {
    const phaseLabels = {
      collectors: { titleKey: 'phases.collectors', icon: 'input', captionKey: 'phases.collectorsCaption' },
      interpreters: { titleKey: 'phases.interpreters', icon: 'psychology', captionKey: 'phases.interpretersCaption' },
      responders: { titleKey: 'phases.responders', icon: 'outbox', captionKey: 'phases.respondersCaption' }
    };

    const params = computed(() => ensureParams(props.doc));
    const legacyEngines = computed(() => Array.isArray(props.doc.engines) ? props.doc.engines : []);

    function addStep(phase) {
      params.value[phase].push({
        engine: props.engines[0]?.value || 'ollama',
        codeType: 'js',
        enabled: true,
        name: `${phase.slice(0, -1)}-${params.value[phase].length + 1}`
      });
      emit('changed');
    }

    function removeStep(phase, index) {
      params.value[phase].splice(index, 1);
      emit('changed');
    }

    return { params, phaseLabels, legacyEngines, addStep, removeStep, emitChanged: () => emit('changed') };
  },
  template: `
    <div>
      <section class="config-meta">
        <q-input v-model="doc.name" dense outlined :label="$t('meta.name')" @update:model-value="emitChanged" />
        <q-input v-model="doc.persona" dense outlined :label="$t('meta.persona')" @update:model-value="emitChanged" />
        <q-input v-model="doc.output" dense outlined :label="$t('meta.outputFolder')" @update:model-value="emitChanged" />
      </section>

      <section v-if="legacyEngines.length" class="legacy-strip">
        <q-icon name="history" />
        <span>{{ $t('meta.legacyEngines') }}</span>
        <q-chip v-for="engine in legacyEngines" :key="engine" dense square>{{ engine }}</q-chip>
      </section>

      <section class="phase-grid">
        <div v-for="phase in ['collectors', 'interpreters', 'responders']" :key="phase" class="phase-lane">
          <div class="phase-head">
            <q-icon :name="phaseLabels[phase].icon" />
            <div>
              <h2>{{ $t(phaseLabels[phase].titleKey) }}</h2>
              <p>{{ $t(phaseLabels[phase].captionKey) }}</p>
            </div>
            <q-btn dense flat round icon="add" color="primary" @click="addStep(phase)">
              <q-tooltip>{{ $t('actions.addExistingEngine') }}</q-tooltip>
            </q-btn>
          </div>

          <engine-step
            v-for="(step, index) in params[phase]"
            :key="index"
            :step="step"
            :engines="engines"
            :index="index"
            @remove="removeStep(phase, index)"
            @changed="emitChanged"
          />

          <div v-if="!params[phase].length" class="phase-empty">
            <q-icon name="playlist_add" />
            <span>{{ $t('phases.empty', { phase: $t(phaseLabels[phase].titleKey).toLowerCase() }) }}</span>
          </div>
        </div>
      </section>
    </div>
  `
});

const WatchEditor = defineComponent({
  name: 'WatchEditor',
  props: {
    entries: { type: Array, required: true }
  },
  emits: ['changed'],
  setup(props, { emit }) {
    function addEntry() {
      props.entries.push({
        type: 'schedule',
        name: `schedule-${props.entries.length + 1}`,
        config: '',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        interval: 60,
        intervalType: 'minutes'
      });
      emit('changed');
    }

    function removeEntry(index) {
      props.entries.splice(index, 1);
      emit('changed');
    }

    return { addEntry, removeEntry, emitChanged: () => emit('changed'), formatLoose, parseLoose };
  },
  template: `
    <section class="watch-section">
      <div class="watch-head">
        <div>
          <div class="eyebrow">{{ $t('watcher.entries') }}</div>
          <h2>{{ $t('watcher.count', { count: entries.length }) }}</h2>
        </div>
        <q-btn color="primary" icon="add" :label="$t('actions.addEntry')" no-caps @click="addEntry" />
      </div>

      <q-card v-for="(entry, index) in entries" :key="index" flat bordered class="watch-card">
        <div class="watch-card-head">
          <q-icon name="event_repeat" />
          <strong>{{ entry.name || entry.config || $t('watcher.entry') }}</strong>
          <q-space />
          <q-btn flat dense round icon="delete" color="negative" @click="removeEntry(index)" />
        </div>
        <div class="watch-grid">
          <q-input v-model="entry.name" dense outlined :label="$t('meta.name')" @update:model-value="emitChanged" />
          <q-input v-model="entry.type" dense outlined :label="$t('watcher.type')" @update:model-value="emitChanged" />
          <q-input v-model="entry.config" dense outlined :label="$t('watcher.configPath')" @update:model-value="emitChanged" />
          <q-input v-model.number="entry.interval" dense outlined type="number" :label="$t('watcher.interval')" @update:model-value="emitChanged" />
          <q-select
            v-model="entry.intervalType"
            :options="['minutes', 'hours', 'days', 'months']"
            dense
            outlined
            :label="$t('watcher.intervalType')"
            @update:model-value="emitChanged"
          />
          <q-input
            :model-value="formatLoose(entry.daysOfWeek)"
            dense
            outlined
            :label="$t('watcher.daysOfWeek')"
            @blur="entry.daysOfWeek = parseLoose($event.target.value); emitChanged()"
          />
          <q-input
            :model-value="formatLoose(entry.daysOfMonth)"
            dense
            outlined
            :label="$t('watcher.daysOfMonth')"
            @blur="entry.daysOfMonth = parseLoose($event.target.value); emitChanged()"
          />
        </div>
      </q-card>
    </section>
  `
});
</script>
