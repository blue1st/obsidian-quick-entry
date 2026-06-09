import { Command } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { enable as enableAutostart, isEnabled as isAutostartEnabled, disable as disableAutostart } from "@tauri-apps/plugin-autostart";

const errorContainer = document.getElementById("error-container");
const errorMessage = document.getElementById("error-message");

async function checkObsidianCli() {
  try {
    const cmd = Command.create("obsidian", ["--version"]);
    const output = await cmd.execute();
    if (output.code !== 0) {
      showError("Obsidian CLI not found. Please ensure it is installed and in your PATH.");
    }
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
      const dateStr = now.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
      const timeStr = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
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

    const isWindows = navigator.userAgent.toLowerCase().includes("win");
    const contentArg = isWindows ? formattedText.replace(/\r?\n/g, "\\n") : formattedText;

    if (destination.startsWith("file:")) {
      const fileName = destination.substring(5);
      args.push("append");
      args.push(`file=${fileName}`);
      args.push(`content=${contentArg}`);
    } else {
      args.push("daily:append");
      args.push(`content=${contentArg}`);
    }
    
    const cmd = Command.create("obsidian", args);
    const output = await cmd.execute();
    
    if (output.code !== 0) {
      const errorMsg = output.stderr.trim() || output.stdout.trim() || `Exit code ${output.code}`;
      showError("Error appending to Obsidian: " + errorMsg);
    } else {
      const entryInput = document.getElementById("entry-input") as HTMLTextAreaElement;
      if (entryInput) {
        entryInput.value = "";
      }
      const currentWindow = getCurrentWindow();
      await currentWindow.hide();
    }
  } catch (err) {
    showError("Failed to execute Obsidian CLI: " + err);
  }
}

function initMainPage() {
  const entryForm = document.getElementById("entry-form") as HTMLFormElement;
  const entryInput = document.getElementById("entry-input") as HTMLTextAreaElement;
  const targetSelect = document.getElementById("target-select") as HTMLSelectElement;
  const openSettingsBtn = document.getElementById("open-settings-btn");

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

  targetSelect?.addEventListener("change", () => {
    localStorage.setItem("obsidian-last-selected-destination", targetSelect.value);
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
    await getCurrentWindow().hide();
  });

  initMainPage();
}
