import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { enable as enableAutostart, isEnabled as isAutostartEnabled, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";

const errorContainer = document.getElementById("error-container");
const errorMessage = document.getElementById("error-message");

const isWindows = navigator.userAgent.toLowerCase().includes("win");
let ignoreNextBlur = false;
let isExecutingCommand = false;
let cliNeedsShell = false;

async function ensureObsidianRunning() {
  try {
    const isRunning = await invoke<boolean>("is_obsidian_running");
    if (!isRunning) {
      console.log("Obsidian is not running. Launching cleanly via URI scheme...");
      await openUrl("obsidian://open");
      // Wait for Obsidian to initialize and open its IPC server
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (err) {
    console.error("Failed to check or start Obsidian:", err);
  }
}

async function executeObsidianCommand(args: string[]) {
  await ensureObsidianRunning();
  isExecutingCommand = true;
  try {
    const output = await invoke<{ code: number; stdout: string; stderr: string }>("execute_obsidian_command", { args });
    return output;
  } finally {
    setTimeout(() => {
      isExecutingCommand = false;
    }, 100);
  }
}

let currentTab: "memo" | "tasks" = "memo";

function cleanObsidianOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  const cleanLines = lines.filter(line => {
    const trimmed = line.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) return false;
    if (trimmed.includes("Your Obsidian installer is out of date")) return false;
    if (trimmed.includes("Please download the latest installer")) return false;
    return true;
  });
  return cleanLines.join("\n").trim();
}

function parseJsonOutput(stdout: string): any {
  const cleaned = cleanObsidianOutput(stdout);
  if (!cleaned) {
    return [];
  }
  
  const normalized = cleaned.toLowerCase();
  if (normalized.includes("no tasks found") || normalized.includes("not found")) {
    return [];
  }
  
  const startIdx = cleaned.indexOf("[");
  const endIdx = cleaned.lastIndexOf("]");
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const jsonStr = cleaned.substring(startIdx, endIdx + 1);
    return JSON.parse(jsonStr);
  }
  
  throw new Error("No JSON array found in CLI output: " + stdout);
}

function cleanTaskText(text: string): string {
  return text.replace(/^-\s*\[.\]\s*/, "");
}

async function checkObsidianCli() {
  try {
    const cliInfo = await invoke<{ exists: boolean; needs_shell: boolean }>("get_obsidian_cli_info");
    if (!cliInfo.exists) {
      showError("Obsidian CLI not found. Please ensure it is installed and in your PATH.");
    }
    cliNeedsShell = cliInfo.needs_shell;
  } catch (err) {
    showError("Failed to verify Obsidian CLI: " + err);
  }
}

function showError(msg: string) {
  if (errorMessage && errorContainer) {
    errorMessage.textContent = msg;
    errorContainer.classList.remove("hidden");
  }
}

function hideError() {
  if (errorContainer) {
    errorContainer.classList.add("hidden");
  }
}

async function appendToDailyNote(text: string) {
  try {
    const customHeadingToggle = document.getElementById("custom-heading-toggle") as HTMLInputElement;
    const customHeadingInput = document.getElementById("custom-heading-input") as HTMLInputElement;
    
    let formattedText = "";
    if (customHeadingToggle?.checked && customHeadingInput?.value.trim()) {
      formattedText = `\n\n${customHeadingInput.value.trim()}\n\n${text}`;
    } else {
      const now = new Date();
      const dateStr = now.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-").replace(/[\u200E\u200F\u202A-\u202E]/g, "");
      const timeStr = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }).replace(/[\u200E\u200F\u202A-\u202E]/g, "");
      formattedText = `\n\n## ${dateStr} ${timeStr}\n\n${text}`;
    }
    
    const targetSelect = document.getElementById("target-select") as HTMLSelectElement;
    const destination = targetSelect ? targetSelect.value : "daily";
    
    const args: string[] = [];
    
    // Add Vault Name if configured
    const currentVault = localStorage.getItem("obsidian-vault") || "";
    if (currentVault) {
      args.push(`vault=${currentVault}`);
    }

    const contentArg = (isWindows && cliNeedsShell) ? formattedText.replace(/\r?\n/g, "\\n") : formattedText;

    if (destination.startsWith("file:")) {
      const fileName = destination.substring(5);
      args.push("append");
      args.push(`file=${fileName}`);
      args.push(`content=${contentArg}`);
    } else {
      args.push("daily:append");
      args.push(`content=${contentArg}`);
    }
    
    console.log("Executing Obsidian CLI command with args:", args);
    const output = await executeObsidianCommand(args);
    console.log("Obsidian CLI command output:", {
      code: output.code,
      stdout: output.stdout,
      stderr: output.stderr
    });
    
    // On Windows, the Obsidian CLI may return exit code -1 (255) even on success.
    // If the exit code is non-zero but stderr is empty on Windows, we treat it as success.
    const cleanStderr = cleanObsidianOutput(output.stderr);
    const isSuccess = output.code === 0 || (isWindows && output.code === -1 && !cleanStderr);

    if (!isSuccess) {
      const details = [];
      if (output.stdout.trim()) details.push(`Stdout: ${output.stdout.trim()}`);
      if (cleanStderr) details.push(`Stderr: ${cleanStderr}`);
      details.push(`Exit code: ${output.code}`);
      showError("Error appending to Obsidian:\n" + details.join("\n"));
    } else {
      const entryInput = document.getElementById("entry-input") as HTMLTextAreaElement;
      if (entryInput) {
        entryInput.value = "";
      }
      const currentWindow = getCurrentWindow();
      await currentWindow.hide();
    }
  } catch (err) {
    console.error("Failed to execute Obsidian CLI:", err);
    showError("Failed to execute Obsidian CLI: " + err);
  }
}

function initMainPage() {
  const entryForm = document.getElementById("entry-form") as HTMLFormElement;
  const entryInput = document.getElementById("entry-input") as HTMLTextAreaElement;
  const targetSelect = document.getElementById("target-select") as HTMLSelectElement;
  const openSettingsBtn = document.getElementById("open-settings-btn");

  const tabMemo = document.getElementById("tab-memo");
  const tabTasks = document.getElementById("tab-tasks");
  const headingControls = document.getElementById("heading-controls");
  const taskViewContainer = document.getElementById("task-view-container");
  const taskList = document.getElementById("task-list") as HTMLUListElement;
  const taskLoading = document.getElementById("task-loading");
  const taskEmpty = document.getElementById("task-empty");
  const footerSaveHint = document.getElementById("footer-save-hint");

  // Memo Task Drafting elements
  const toggleMemoTaskBtn = document.getElementById("toggle-memo-task-btn") as HTMLButtonElement;
  const memoTaskInputContainer = document.getElementById("memo-task-input-container");
  const memoTaskInput = document.getElementById("memo-task-input") as HTMLInputElement;

  // Note Viewer elements
  const viewNoteBtn = document.getElementById("view-note-btn");
  const noteViewerDrawer = document.getElementById("note-viewer-drawer");
  const closeDrawerBtn = document.getElementById("close-drawer-btn");
  const drawerTitle = document.getElementById("drawer-title");
  const drawerLoading = document.getElementById("drawer-loading");
  const drawerContent = document.getElementById("drawer-content");

  let isMemoTaskHelperVisible = false;

  // Load target files and populate dropdown
  function populateDropdown() {
    if (!targetSelect) return;
    
    // Clear custom options, keeping only Daily Note
    while (targetSelect.options.length > 1) {
      targetSelect.remove(1);
    }
    
    const predefinedFiles: string[] = JSON.parse(localStorage.getItem("obsidian-predefined-files") || "[]");
    predefinedFiles.forEach(file => {
      const option = document.createElement("option");
      option.value = `file:${file}`;
      option.textContent = file;
      targetSelect.appendChild(option);
    });

    // Restore last selected destination
    const lastSelected = localStorage.getItem("obsidian-last-selected-destination") || "daily";
    if (lastSelected === "daily" || predefinedFiles.includes(lastSelected.replace("file:", ""))) {
      targetSelect.value = lastSelected;
    }
  }

  populateDropdown();

  async function fetchTasks() {
    if (!taskList || !taskLoading || !taskEmpty) return;
    
    hideError();
    taskLoading.classList.remove("hidden");
    taskEmpty.classList.add("hidden");
    taskList.innerHTML = "";
    
    try {
      const destination = targetSelect ? targetSelect.value : "daily";
      
      // Check if the note exists first by attempting to read it.
      // This prevents Obsidian from opening/creating today's daily note GUI if it doesn't exist yet.
      const readArgs: string[] = [];
      const currentVault = localStorage.getItem("obsidian-vault") || "";
      if (currentVault) {
        readArgs.push(`vault=${currentVault}`);
      }
      if (destination.startsWith("file:")) {
        const fileName = destination.substring(5);
        readArgs.push("read");
        readArgs.push(`file=${fileName}`);
      } else {
        readArgs.push("daily:read");
      }
      
      console.log("Checking if note exists before fetching tasks:", readArgs);
      const readOutput = await executeObsidianCommand(readArgs);
      const cleanReadStderr = cleanObsidianOutput(readOutput.stderr);
      const readSuccess = readOutput.code === 0 || (isWindows && readOutput.code === -1 && !cleanReadStderr);
      
      if (!readSuccess) {
        const errorMsg = cleanReadStderr || readOutput.stdout.trim() || "";
        // If note is not found or does not exist, it means there are no tasks
        if (
          errorMsg.toLowerCase().includes("not found") ||
          errorMsg.toLowerCase().includes("does not exist") ||
          (readOutput.code !== 0 && !errorMsg)
        ) {
          taskEmpty.classList.remove("hidden");
          return;
        }
        // For other errors, show them
        showError("Failed to verify note existence: " + errorMsg);
        return;
      }
      
      // Parse content in JS to see if there are any tasks.
      // This avoids executing 'obsidian tasks' (which can trigger notice popups in Obsidian GUI) if the note has no tasks.
      const noteContent = readOutput.stdout;
      const hasTasks = /^\s*-\s*\[.\]/m.test(noteContent);
      if (!hasTasks) {
        console.log("No tasks found in note content (JS pre-check). Skipping CLI tasks command.");
        taskEmpty.classList.remove("hidden");
        return;
      }

      // If the note exists, retrieve the tasks
      const args: string[] = [];
      if (currentVault) {
        args.push(`vault=${currentVault}`);
      }
      args.push("tasks");
      if (destination.startsWith("file:")) {
        const fileName = destination.substring(5);
        args.push(`file=${fileName}`);
      } else {
        args.push("daily");
      }
      args.push("format=json");
      
      console.log("Executing Obsidian CLI command (fetchTasks) with args:", args);
      const output = await executeObsidianCommand(args);
      console.log("Obsidian CLI command output (fetchTasks):", {
        code: output.code,
        stdout: output.stdout,
        stderr: output.stderr
      });
      
      const cleanStderr = cleanObsidianOutput(output.stderr);
      const isSuccess = output.code === 0 || (isWindows && output.code === -1 && !cleanStderr);

      if (!isSuccess) {
        const errorMsg = cleanStderr || output.stdout.trim() || `Exit code ${output.code}`;
        showError("Failed to fetch tasks: " + errorMsg);
        return;
      }
      
      const tasks = parseJsonOutput(output.stdout);
      if (!tasks || tasks.length === 0) {
        taskEmpty.classList.remove("hidden");
        return;
      }
      
      tasks.forEach((task: any) => {
        const li = document.createElement("li");
        li.className = "task-item";
        
        const isDone = task.status.trim().toLowerCase() === "x";
        if (isDone) {
          li.classList.add("done");
        }
        
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "task-checkbox";
        checkbox.checked = isDone;
        
        const textSpan = document.createElement("span");
        textSpan.className = "task-text";
        textSpan.textContent = cleanTaskText(task.text);
        
        const handleToggle = async (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          
          const nextCheckedState = !checkbox.checked;
          checkbox.checked = nextCheckedState;
          if (nextCheckedState) {
            li.classList.add("done");
          } else {
            li.classList.remove("done");
          }
          
          checkbox.disabled = true;
          textSpan.style.pointerEvents = "none";
          
          await toggleTask(task);
        };
        
        checkbox.addEventListener("change", handleToggle);
        textSpan.addEventListener("click", handleToggle);
        
        li.appendChild(checkbox);
        li.appendChild(textSpan);
        taskList.appendChild(li);
      });
    } catch (err) {
      showError("Failed to fetch tasks: " + err);
    } finally {
      taskLoading.classList.add("hidden");
    }
  }

  async function toggleTask(task: any) {
    try {
      const args: string[] = [];
      const currentVault = localStorage.getItem("obsidian-vault") || "";
      if (currentVault) {
        args.push(`vault=${currentVault}`);
      }
      args.push("task");
      args.push(`path=${task.file}`);
      args.push(`line=${task.line}`);
      args.push("toggle");
      
      console.log("Executing Obsidian CLI command (toggleTask) with args:", args);
      const output = await executeObsidianCommand(args);
      console.log("Obsidian CLI command output (toggleTask):", {
        code: output.code,
        stdout: output.stdout,
        stderr: output.stderr
      });
      
      const cleanStderr = cleanObsidianOutput(output.stderr);
      const isSuccess = output.code === 0 || (isWindows && output.code === -1 && !cleanStderr);

      if (!isSuccess) {
        const errorMsg = cleanStderr || output.stdout.trim() || `Exit code ${output.code}`;
        showError("Failed to update task status: " + errorMsg);
      }
      
      await fetchTasks();
    } catch (err) {
      showError("Failed to execute task update: " + err);
    }
  }

  function toggleMemoTaskHelper() {
    isMemoTaskHelperVisible = !isMemoTaskHelperVisible;
    if (isMemoTaskHelperVisible) {
      memoTaskInputContainer?.classList.remove("hidden");
      toggleMemoTaskBtn?.classList.add("active");
      memoTaskInput?.focus();
    } else {
      memoTaskInputContainer?.classList.add("hidden");
      toggleMemoTaskBtn?.classList.remove("active");
      entryInput?.focus();
    }
  }

  function insertTaskIntoMemo(taskText: string) {
    if (!entryInput) return;
    
    const startPos = entryInput.selectionStart;
    const endPos = entryInput.selectionEnd;
    const text = entryInput.value;
    
    const insertedText = `- [ ] ${taskText}\n`;
    entryInput.value = text.substring(0, startPos) + insertedText + text.substring(endPos);
    
    const newCursorPos = startPos + insertedText.length;
    entryInput.setSelectionRange(newCursorPos, newCursorPos);
    
    memoTaskInput?.focus();
  }

  async function openNoteViewer() {
    if (!noteViewerDrawer || !drawerTitle || !drawerLoading || !drawerContent) return;
    
    const destination = targetSelect ? targetSelect.value : "daily";
    const titleText = destination.startsWith("file:") ? destination.substring(5) : "Daily Note";
    
    drawerTitle.textContent = titleText;
    noteViewerDrawer.classList.add("open");
    drawerLoading.classList.remove("hidden");
    drawerContent.classList.add("hidden");
    drawerContent.textContent = "";
    
    try {
      const args: string[] = [];
      const currentVault = localStorage.getItem("obsidian-vault") || "";
      if (currentVault) {
        args.push(`vault=${currentVault}`);
      }
      
      if (destination.startsWith("file:")) {
        const fileName = destination.substring(5);
        args.push("read");
        args.push(`file=${fileName}`);
      } else {
        args.push("daily:read");
      }
      
      console.log("Executing Obsidian CLI command (openNoteViewer) with args:", args);
      const output = await executeObsidianCommand(args);
      console.log("Obsidian CLI command output (openNoteViewer):", {
        code: output.code,
        stdout: output.stdout,
        stderr: output.stderr
      });
      
      const cleanStderr = cleanObsidianOutput(output.stderr);
      const isSuccess = output.code === 0 || (isWindows && output.code === -1 && !cleanStderr);

      if (!isSuccess) {
        const errorMsg = cleanStderr || output.stdout.trim() || `Exit code ${output.code}`;
        if (errorMsg.toLowerCase().includes("not found")) {
          drawerContent.textContent = "Note is empty or has not been created yet.";
        } else {
          drawerContent.textContent = "Error reading note: " + errorMsg;
        }
      } else {
        const cleanedText = cleanObsidianOutput(output.stdout);
        drawerContent.textContent = cleanedText || "(Empty Note)";
      }
      drawerContent.classList.remove("hidden");
    } catch (err) {
      drawerContent.textContent = "Failed to load note content: " + err;
      drawerContent.classList.remove("hidden");
    } finally {
      drawerLoading.classList.add("hidden");
    }
  }

  function closeNoteViewer() {
    noteViewerDrawer?.classList.remove("open");
  }

  toggleMemoTaskBtn?.addEventListener("click", () => {
    toggleMemoTaskHelper();
  });

  memoTaskInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = memoTaskInput.value.trim();
      if (val) {
        insertTaskIntoMemo(val);
        memoTaskInput.value = "";
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      toggleMemoTaskHelper();
    }
  });

  viewNoteBtn?.addEventListener("click", () => {
    openNoteViewer();
  });

  closeDrawerBtn?.addEventListener("click", () => {
    closeNoteViewer();
  });

  // Intercept escape key on window level to close drawer if open
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && noteViewerDrawer?.classList.contains("open")) {
      e.stopPropagation();
      closeNoteViewer();
    }
  }, true);

  function switchTab(tab: "memo" | "tasks") {
    currentTab = tab;
    if (tab === "memo") {
      tabMemo?.classList.add("active");
      tabTasks?.classList.remove("active");
      
      headingControls?.classList.remove("hidden");
      toggleMemoTaskBtn?.classList.remove("hidden");
      viewNoteBtn?.classList.remove("hidden");
      entryForm?.classList.remove("hidden");
      taskViewContainer?.classList.add("hidden");
      
      if (footerSaveHint) {
        footerSaveHint.innerHTML = "Press <strong>⌘Enter</strong> to save";
      }
      
      if (isMemoTaskHelperVisible) {
        memoTaskInput?.focus();
      } else {
        entryInput?.focus();
      }
    } else {
      tabMemo?.classList.remove("active");
      tabTasks?.classList.add("active");
      
      headingControls?.classList.add("hidden");
      toggleMemoTaskBtn?.classList.add("hidden");
      viewNoteBtn?.classList.add("hidden");
      entryForm?.classList.add("hidden");
      taskViewContainer?.classList.remove("hidden");
      
      if (footerSaveHint) {
        footerSaveHint.innerHTML = "Task completion status list";
      }
      
      fetchTasks();
    }
  }

  tabMemo?.addEventListener("click", () => switchTab("memo"));
  tabTasks?.addEventListener("click", () => switchTab("tasks"));

  targetSelect?.addEventListener("change", () => {
    localStorage.setItem("obsidian-last-selected-destination", targetSelect.value);
    if (currentTab === "tasks") {
      fetchTasks();
    }
  });

  const customHeadingToggle = document.getElementById("custom-heading-toggle") as HTMLInputElement;
  const customHeadingInput = document.getElementById("custom-heading-input") as HTMLInputElement;

  if (customHeadingToggle && customHeadingInput) {
    const useCustomHeading = localStorage.getItem("obsidian-use-custom-heading") === "true";
    const popupCustomHeading = localStorage.getItem("obsidian-popup-custom-heading") || "";

    customHeadingToggle.checked = useCustomHeading;
    customHeadingInput.value = popupCustomHeading;

    if (useCustomHeading) {
      customHeadingInput.classList.remove("hidden");
    } else {
      customHeadingInput.classList.add("hidden");
    }

    customHeadingToggle.addEventListener("change", () => {
      const checked = customHeadingToggle.checked;
      localStorage.setItem("obsidian-use-custom-heading", String(checked));
      if (checked) {
        customHeadingInput.classList.remove("hidden");
        customHeadingInput.focus();
      } else {
        customHeadingInput.classList.add("hidden");
      }
    });

    customHeadingInput.addEventListener("input", () => {
      localStorage.setItem("obsidian-popup-custom-heading", customHeadingInput.value.trim());
    });
  }

  entryForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    hideError();
    const text = entryInput.value.trim();
    if (text) {
      appendToDailyNote(text);
    }
  });

  entryInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      entryForm?.requestSubmit();
    }
  });

  openSettingsBtn?.addEventListener("click", async () => {
    const windows = await getAllWebviewWindows();
    const settingsWin = windows.find(w => w.label === "settings");
    if (settingsWin) {
      await settingsWin.show();
      await settingsWin.setFocus();
    } else {
      try {
        new WebviewWindow("settings", {
          url: "index.html#settings",
          title: "Settings",
          width: 450,
          height: 500,
          alwaysOnTop: true,
        });
      } catch (err) {
        console.error("Failed to open settings window:", err);
      }
    }
  });

  // Focus listener to refresh tasks when tray app gains focus
  getCurrentWindow().listen('tauri://focus', async () => {
    ignoreNextBlur = false;
    if (currentTab === "tasks") {
      await fetchTasks();
    }
  });

  // Watch for changes from the settings window
  window.addEventListener("storage", (e) => {
    if (e.key === "obsidian-predefined-files") {
      populateDropdown();
    }
  });

  // Check CLI on load
  checkObsidianCli();
}

async function initSettingsPage() {
  const vaultInput = document.getElementById("vault-input") as HTMLInputElement;
  const headingInput = document.getElementById("heading-input") as HTMLInputElement;
  const autostartCheckbox = document.getElementById("autostart-checkbox") as HTMLInputElement;
  const newFileInput = document.getElementById("new-file-input") as HTMLInputElement;
  const addFileBtn = document.getElementById("add-file-btn") as HTMLButtonElement;
  const filesList = document.getElementById("files-list") as HTMLUListElement;
  const closeSettingsBtn = document.getElementById("close-settings-btn") as HTMLButtonElement;

  // 1. Vault Name & Formatting Configuration
  let vaultName = localStorage.getItem("obsidian-vault") || "";
  if (vaultInput) {
    vaultInput.value = vaultName;
    vaultInput.addEventListener("input", () => {
      localStorage.setItem("obsidian-vault", vaultInput.value.trim());
    });
  }

  let customHeading = localStorage.getItem("obsidian-custom-heading") || "";
  if (headingInput) {
    headingInput.value = customHeading;
    headingInput.addEventListener("input", () => {
      localStorage.setItem("obsidian-custom-heading", headingInput.value.trim());
    });
  }

  // 2. Autostart Configuration
  try {
    const enabled = await isAutostartEnabled();
    if (autostartCheckbox) {
      autostartCheckbox.checked = enabled;
      autostartCheckbox.addEventListener("change", async () => {
        if (autostartCheckbox.checked) {
          await enableAutostart();
        } else {
          await disableAutostart();
        }
      });
    }
  } catch (err) {
    console.error("Failed to initialize autostart setting:", err);
  }

  // 3. Predefined Target Files Manager
  let predefinedFiles: string[] = JSON.parse(localStorage.getItem("obsidian-predefined-files") || "[]");
  
  function renderFilesList() {
    if (!filesList) return;
    filesList.innerHTML = "";
    predefinedFiles.forEach((file, index) => {
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <span>${file}</span>
        <button type="button" data-index="${index}">Delete</button>
      `;
      filesList.appendChild(li);
    });
  }

  renderFilesList();

  filesList?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON") {
      const index = parseInt(target.getAttribute("data-index") || "0");
      predefinedFiles.splice(index, 1);
      localStorage.setItem("obsidian-predefined-files", JSON.stringify(predefinedFiles));
      renderFilesList();
      // Dispatch storage event manually for same-page testing
      window.dispatchEvent(new StorageEvent("storage", { key: "obsidian-predefined-files" }));
    }
  });

  addFileBtn?.addEventListener("click", () => {
    const newFile = newFileInput.value.trim();
    if (newFile && !predefinedFiles.includes(newFile)) {
      predefinedFiles.push(newFile);
      localStorage.setItem("obsidian-predefined-files", JSON.stringify(predefinedFiles));
      newFileInput.value = "";
      renderFilesList();
      window.dispatchEvent(new StorageEvent("storage", { key: "obsidian-predefined-files" }));
    }
  });

  newFileInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFileBtn?.click();
    }
  });

  closeSettingsBtn?.addEventListener("click", async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.close();
  });
}

// Simple Router
if (window.location.hash === "#settings") {
  document.body.classList.add("settings-page");
  document.getElementById("main-view")?.classList.add("hidden");
  document.getElementById("settings-view")?.classList.remove("hidden");
  initSettingsPage();
} else {
  document.body.classList.remove("settings-page");
  document.getElementById("main-view")?.classList.remove("hidden");
  document.getElementById("settings-view")?.classList.add("hidden");
  
  // Hide window on Esc key
  window.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      const currentWindow = getCurrentWindow();
      await currentWindow.hide();
    }
  });

  // Hide window on blur
  getCurrentWindow().listen('tauri://blur', async () => {
    if (ignoreNextBlur || isExecutingCommand) {
      ignoreNextBlur = false;
      return;
    }
    await getCurrentWindow().hide();
  });

  initMainPage();
}

// Initialize version labels using injected Vite metadata
const appVersion = (import.meta as any).env.APP_VERSION || "0.1.16";
const mainVersionLabel = document.getElementById("app-version-label");
if (mainVersionLabel) {
  mainVersionLabel.textContent = `v${appVersion}`;
}
const settingsVersionLabel = document.getElementById("settings-version-label");
if (settingsVersionLabel) {
  settingsVersionLabel.textContent = `v${appVersion}`;
}

// Programmatic window dragging fallback for frameless window
const mainViewEl = document.getElementById("main-view");
mainViewEl?.addEventListener("mousedown", (e) => {
  if (e.button === 0) { // Left-click only
    const target = e.target as HTMLElement;
    // Don't drag if clicking interactive fields or panels
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "BUTTON" ||
      target.tagName === "SELECT" ||
      target.closest("button") ||
      target.closest(".clickable") ||
      target.closest(".task-item") ||
      target.closest(".icon-toggle-btn") ||
      target.closest(".drawer")
    ) {
      return;
    }
    ignoreNextBlur = true;
    setTimeout(() => {
      ignoreNextBlur = false;
    }, 200);
    getCurrentWindow().startDragging();
  }
});
