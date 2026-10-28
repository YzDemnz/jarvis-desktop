/**
 * Single source of truth for every IPC channel.
 * The renderer never talks to Node directly — it only sees the whitelisted
 * surface exposed in preload.ts.
 */
export const IPC = {
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    isMaximized: 'window:is-maximized',
    maximizedChanged: 'window:maximized-changed',
  },
  app: {
    platform: 'app:platform',
    version: 'app:version',
  },
  fabric: {
    appendMessage: 'fabric:append-message',
    messagePage: 'fabric:message-page',
    saveTask: 'fabric:save-task',
    task: 'fabric:task',
    taskPage: 'fabric:task-page',
    handoff: 'fabric:handoff',
    usagePage: 'fabric:usage-page',
    quota: 'fabric:quota',
    routingPage: 'fabric:routing-page',
  },
  hotkeys: {
    commandPalette: 'hotkey:command-palette',
    stopAgent: 'hotkey:stop-agent',
    /** Combos intercepted inside a web page and forwarded to the shell. */
    forwarded: 'hotkey:forwarded',
  },

  /**
   * Real Chromium browsing. Every channel is a named command; the renderer
   * never receives a WebContents, only serialisable state.
   */
  browser: {
    // lifecycle
    create: 'browser:create',
    close: 'browser:close',
    activate: 'browser:activate',
    setPinned: 'browser:set-pinned',
    setProfile: 'browser:set-profile',
    // navigation
    navigate: 'browser:navigate',
    back: 'browser:back',
    forward: 'browser:forward',
    reload: 'browser:reload',
    stop: 'browser:stop',
    // layout — the renderer owns the geometry, main owns the surface
    setBounds: 'browser:set-bounds',
    setVisible: 'browser:set-visible',
    // state
    snapshot: 'browser:snapshot',
    stateChanged: 'browser:state-changed',
    // data
    profiles: 'browser:profiles',
    history: 'browser:history',
    clearHistory: 'browser:clear-history',
    bookmarks: 'browser:bookmarks',
    addBookmark: 'browser:add-bookmark',
    removeBookmark: 'browser:remove-bookmark',
    downloads: 'browser:downloads',
    downloadsChanged: 'browser:downloads-changed',
    cancelDownload: 'browser:cancel-download',
    permissions: 'browser:permissions',
    setPermission: 'browser:set-permission',
    // read-only page inspection (available to JARVIS today)
    pageText: 'browser:page-text',
    domSnapshot: 'browser:dom-snapshot',
    screenshot: 'browser:screenshot',
    // declared, deliberately not implemented until the permission layer lands
    findElements: 'browser:find-elements',
    clickElement: 'browser:click-element',
    typeIntoElement: 'browser:type-into-element',
    executeAction: 'browser:execute-action',
  },

  /**
   * Agent capabilities. One explicit channel per capability family — never a
   * generic `execute(command, args)`. Every handler re-validates the caller's
   * permission level against the tool registry before touching the system.
   */
  agent: {
    fsGetDrives: 'agent:fs-get-drives',
    fsList: 'agent:fs-list',
    fsStat: 'agent:fs-stat',
    fsExists: 'agent:fs-exists',
    fsSearch: 'agent:fs-search',
    fsReadText: 'agent:fs-read-text',
    fsSearchStatus: 'agent:fs-search-status',
    appList: 'agent:app-list',
    systemInfo: 'agent:system-info',
    processList: 'agent:process-list',
    ollamaHealth: 'agent:ollama-health',
    ollamaModels: 'agent:ollama-models',
    route: 'agent:route',
    notifyReady: 'agent:notify-ready',
    ready: 'agent:ready',
  },

  /**
   * Machine intelligence. Read-only inspection of the computer plus local AI
   * discovery. No channel here can install, download or execute anything.
   */
  machine: {
    identity: 'machine:identity',
    profile: 'machine:profile',
    useFixture: 'machine:use-fixture',
    discoverLocalAI: 'machine:discover-local-ai',
    localAIState: 'machine:local-ai-state',
    recommend: 'machine:recommend',
    catalog: 'machine:catalog',
    benchmark: 'machine:benchmark',
    cancelBenchmark: 'machine:cancel-benchmark',
    openOfficialSource: 'machine:open-official-source',
  },

  /**
   * Desktop control. One named channel per tool — the list is closed and every
   * handler validates its own arguments. There is no generic execute channel.
   */
  desktopTools: {
    'window.list': 'desktop:window.list',
    'window.active': 'desktop:window.active',
    'window.find': 'desktop:window.find',
    'window.focus': 'desktop:window.focus',
    'window.minimize': 'desktop:window.minimize',
    'window.maximize': 'desktop:window.maximize',
    'window.restore': 'desktop:window.restore',
    'window.move': 'desktop:window.move',
    'window.resize': 'desktop:window.resize',
    'window.close': 'desktop:window.close',
    'ui.inspect': 'desktop:ui.inspect',
    'ui.find': 'desktop:ui.find',
    'ui.focus': 'desktop:ui.focus',
    'ui.invoke': 'desktop:ui.invoke',
    'ui.setValue': 'desktop:ui.setValue',
    'ui.toggle': 'desktop:ui.toggle',
    'ui.select': 'desktop:ui.select',
    'ui.expand': 'desktop:ui.expand',
    'ui.collapse': 'desktop:ui.collapse',
    'ui.scroll': 'desktop:ui.scroll',
    'screen.captureDisplay': 'desktop:screen.captureDisplay',
    'screen.captureWindow': 'desktop:screen.captureWindow',
    'screen.captureRegion': 'desktop:screen.captureRegion',
    'mouse.move': 'desktop:mouse.move',
    'mouse.click': 'desktop:mouse.click',
    'mouse.doubleClick': 'desktop:mouse.doubleClick',
    'mouse.rightClick': 'desktop:mouse.rightClick',
    'mouse.scroll': 'desktop:mouse.scroll',
    'mouse.drag': 'desktop:mouse.drag',
    'keyboard.press': 'desktop:keyboard.press',
    'keyboard.hotkey': 'desktop:keyboard.hotkey',
    'keyboard.type': 'desktop:keyboard.type',
    'app.launch': 'desktop:app.launch',
    'process.list': 'desktop:process.list',
    'process.find': 'desktop:process.find',
    'process.info': 'desktop:process.info',
    'desktop.snapshot': 'desktop:desktop.snapshot',
  },

  devTools: {
    'project.discover': 'dev:project.discover',
    'project.list': 'dev:project.list',
    'project.inspect': 'dev:project.inspect',
    'project.open': 'dev:project.open',
    'project.checks': 'dev:project.checks',
    'project.verify': 'dev:project.verify',
    'code.search': 'dev:code.search',
    'code.searchText': 'dev:code.searchText',
    'code.searchFiles': 'dev:code.searchFiles',
    'code.findReferences': 'dev:code.findReferences',
    'code.findDefinition': 'dev:code.findDefinition',
    'code.context': 'dev:code.context',
    'file.read': 'dev:file.read',
    'file.proposePatch': 'dev:file.proposePatch',
    'file.create': 'dev:file.create',
    'file.write': 'dev:file.write',
    'file.patch': 'dev:file.patch',
    'file.rename': 'dev:file.rename',
    'file.move': 'dev:file.move',
    'file.copy': 'dev:file.copy',
    'directory.create': 'dev:directory.create',
    'file.trash': 'dev:file.trash',
    'terminal.execute': 'dev:terminal.execute',
    'terminal.output': 'dev:terminal.output',
    'process.start': 'dev:process.start',
    'process.status': 'dev:process.status',
    'process.logs': 'dev:process.logs',
    'process.stop': 'dev:process.stop',
    'dev.tools': 'dev:dev.tools',
    'git.status': 'dev:git.status',
    'git.diff': 'dev:git.diff',
    'git.log': 'dev:git.log',
    'git.branch': 'dev:git.branch',
    'git.show': 'dev:git.show',
    'git.add': 'dev:git.add',
    'git.restore': 'dev:git.restore',
    'git.checkoutFile': 'dev:git.checkoutFile',
    'git.commit': 'dev:git.commit',
    'changes.review': 'dev:changes.review',
    'changes.revert': 'dev:changes.revert',
    'changes.undoLast': 'dev:changes.undoLast',
  },

  dev: {
    checkEvidence: 'dev:check-evidence',
    authorize: 'dev:authorize',
    cancelRun: 'dev:cancel-run',
    roots: 'dev:roots',
    addRoot: 'dev:add-root',
    removeRoot: 'dev:remove-root',
    discover: 'dev:discover',
    openProject: 'dev:open-project',
    readFile: 'dev:read-file',
    saveFile: 'dev:save-file',
    changeSets: 'dev:change-sets',
    fileDiff: 'dev:file-diff',
    revertRun: 'dev:revert-run',
    undoLast: 'dev:undo-last',
    commands: 'dev:commands',
    commandEvent: 'dev:command-event',
    fileEvent: 'dev:file-event',
    propose: 'dev:propose',
    processEvent: 'dev:process-event',
    revertFile: 'dev:revert-file',
    outputSearch: 'dev:output-search',
    processes: 'dev:processes',
    processLogs: 'dev:process-logs',
    stopProcess: 'dev:stop-process',
  },

  desktop: {
    status: 'desktop:status',
    statusChanged: 'desktop:status-changed',
    bindRun: 'desktop:bind-run',
    releaseRun: 'desktop:release-run',
    stop: 'desktop:stop',
    pause: 'desktop:pause',
    resume: 'desktop:resume',
    apps: 'desktop:apps',
    setEmergencyShortcut: 'desktop:set-emergency-shortcut',
    emergencyStop: 'desktop:emergency-stop',
    humanOverride: 'desktop:human-override',
  },

  /** Reserved for later stages — no main-process implementation exists yet. */
  reserved: {
    fsRead: 'fs:read',
    fsWrite: 'fs:write',
    fsDelete: 'fs:delete',
    terminalRun: 'terminal:run',
    gitStatus: 'git:status',
    inputMouse: 'input:mouse',
    inputKeyboard: 'input:keyboard',
    screenCapture: 'screen:capture',
    vaultHandle: 'vault:get-handle',
  },
} as const;
