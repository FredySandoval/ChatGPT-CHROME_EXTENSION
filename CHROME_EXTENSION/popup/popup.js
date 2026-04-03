document.addEventListener('DOMContentLoaded', function () {
  const progressDiv = document.getElementById('progress');
  const allJsonButton = document.getElementById('download-as-json');
  const allRawJsonButton = document.getElementById('download-as-raw-json');
  const allMarkdownButton = document.getElementById('download-as-markdown');
  const stopAllBackupButton = document.getElementById('stop-all-backup');
  const currentProjectJsonButton = document.getElementById('download-current-project-as-json');
  const currentProjectRawJsonButton = document.getElementById('download-current-project-as-raw-json');
  const currentProjectMarkdownButton = document.getElementById('download-current-project-as-markdown');
  const stopCurrentProjectBackupButton = document.getElementById('stop-current-project-backup');
  const allChatsSection = document.getElementById('all-chats-section');
  const allChatsLabel = document.getElementById('all-chats-label');
  const currentProjectSection = document.getElementById('current-project-section');

  function setAllBackupRunningState(isRunning) {
    allJsonButton.classList.toggle('hidden', isRunning);
    allRawJsonButton.classList.toggle('hidden', isRunning);
    allMarkdownButton.classList.toggle('hidden', isRunning);
    stopAllBackupButton.classList.toggle('hidden', !isRunning);
  }

  function setCurrentProjectBackupRunningState(isRunning) {
    currentProjectJsonButton.classList.toggle('hidden', isRunning);
    currentProjectRawJsonButton.classList.toggle('hidden', isRunning);
    currentProjectMarkdownButton.classList.toggle('hidden', isRunning);
    stopCurrentProjectBackupButton.classList.toggle('hidden', !isRunning);
  }

  function resetRunningStates() {
    setAllBackupRunningState(false);
    setCurrentProjectBackupRunningState(false);
  }

  function showResponseStatus(response, fallbackSuccessText = 'Download complete') {
    if (chrome.runtime.lastError) {
      progressDiv.innerHTML = `Error: ${chrome.runtime.lastError.message}`;
      resetRunningStates();
      return;
    }

    if (!response) {
      progressDiv.innerHTML = fallbackSuccessText;
      resetRunningStates();
      return;
    }

    if (response.cancelled) {
      progressDiv.innerHTML = `Stopped and downloaded ${response.conversations?.length || response.rawConversations?.length || 0} chats${response.failures?.length ? `, skipped ${response.failures.length}` : ''}`;
      resetRunningStates();
      return;
    }

    if (response.error) {
      progressDiv.innerHTML = `Error: ${response.error}`;
      resetRunningStates();
      return;
    }

    if (response.failures?.length) {
      progressDiv.innerHTML = `Done: ${response.conversations?.length || response.rawConversations?.length || 0} chats, skipped ${response.failures.length}`;
      resetRunningStates();
      return;
    }

    progressDiv.innerHTML = fallbackSuccessText;
    resetRunningStates();
  }

  chrome.storage.local.get(['colorScheme'], function (result) {
    const container = document.querySelector('.extension-container');
    container.classList.add(result.colorScheme);
    console.log('popup.js colorScheme', result);
  });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTabUrl = tabs?.[0]?.url || '';
    const isProjectChat = /^https:\/\/chatgpt\.com\/g\/g-p-[^/]+\/c\//.test(activeTabUrl);

    allChatsSection.classList.toggle('hidden', isProjectChat);
    currentProjectSection.classList.toggle('hidden', !isProjectChat);
    allChatsLabel.textContent = isProjectChat ? 'Backup current project as' : 'Backup all chats as';
  });

  const defaultUserLabel = '<img src="https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png" width="24" alt="User" />';
  const defaultAssistantLabel = '<img src="https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg" width="24" alt="Assistant" />';
  let userLabel = defaultUserLabel;
  let assistantLabel = defaultAssistantLabel;
  let markdownExtension = '.md';
  let mdxFrontmatter = '---\ntitle: "{{title}}"\n---';
  let autoAdvanceStartOffset = true;
  let currentStartOffset = 0;

  function maybeAdvanceStartOffset(response) {
    if (!autoAdvanceStartOffset || !response || response.error) return;

    const downloadedCount = response.conversations?.length || response.rawConversations?.length || 0;
    if (!downloadedCount) return;

    currentStartOffset += downloadedCount;
    chrome.storage.sync.set({ startOffset: currentStartOffset }, () => {
      console.log('startOffset auto-advanced to:', currentStartOffset);
    });
  }

  chrome.storage.sync.get(['startOffset', 'stopOffset', 'userLabel', 'assistantLabel', 'markdownExtension', 'mdxFrontmatter', 'autoAdvanceStartOffset'], function (result) {
    const startOffset = Number(result.startOffset ?? 0);
    const stopOffset = Number(result.stopOffset ?? -1);
    currentStartOffset = startOffset;
    userLabel = result.userLabel || defaultUserLabel;
    assistantLabel = result.assistantLabel || defaultAssistantLabel;
    markdownExtension = result.markdownExtension || '.md';
    mdxFrontmatter = result.mdxFrontmatter || '---\ntitle: "{{title}}"\n---';
    autoAdvanceStartOffset = result.autoAdvanceStartOffset ?? true;

    allJsonButton.addEventListener('click', function () {
      setAllBackupRunningState(true);
      progressDiv.innerHTML = 'Fetching chats for JSON backup...';
      chrome.runtime.sendMessage({ message: 'backUpAllAsJSON', startOffset, stopOffset }, function (response) {
        maybeAdvanceStartOffset(response);
        showResponseStatus(response);
      });
    });

    allRawJsonButton.addEventListener('click', function () {
      setAllBackupRunningState(true);
      progressDiv.innerHTML = 'Fetching chats for raw JSON backup...';
      chrome.runtime.sendMessage({ message: 'backUpAllAsRAWJSON', startOffset, stopOffset }, function (response) {
        maybeAdvanceStartOffset(response);
        showResponseStatus(response);
      });
    });

    allMarkdownButton.addEventListener('click', function () {
      setAllBackupRunningState(true);
      progressDiv.innerHTML = 'Fetching chats for markdown backup...';
      chrome.runtime.sendMessage({ message: 'backUpAllAsMARKDOWN', startOffset, stopOffset, userLabel, assistantLabel, markdownExtension, mdxFrontmatter }, function (response) {
        maybeAdvanceStartOffset(response);
        showResponseStatus(response);
      });
    });
  });

  stopAllBackupButton.addEventListener('click', function () {
    progressDiv.innerHTML = 'Stopping backup and preparing partial download...';
    chrome.runtime.sendMessage({ message: 'stopBackup' }, function (response) {
      if (chrome.runtime.lastError) {
        progressDiv.innerHTML = `Error: ${chrome.runtime.lastError.message}`;
        resetRunningStates();
        return;
      }

      if (!response?.stopping) {
        progressDiv.innerHTML = 'No backup is currently running';
        resetRunningStates();
      }
    });
  });

  document.getElementById('download-current-chat-as-json').addEventListener('click', function () {
    progressDiv.innerHTML = 'Preparing current chat JSON backup...';
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.runtime.sendMessage({ message: 'backUpSingleChat', tabs, downloadType: 'json' }, function (response) {
        showResponseStatus(response);
      });
    });
  });

  document.getElementById('download-current-chat-as-raw-json').addEventListener('click', function () {
    progressDiv.innerHTML = 'Preparing current chat raw JSON backup...';
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.runtime.sendMessage({ message: 'backUpSingleChat', tabs, downloadType: 'raw-json' }, function (response) {
        showResponseStatus(response);
      });
    });
  });

  document.getElementById('download-current-chat-as-markdown').addEventListener('click', function () {
    progressDiv.innerHTML = 'Preparing current chat markdown backup...';
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.runtime.sendMessage({ message: 'backUpSingleChat', tabs, downloadType: 'markdown', userLabel, assistantLabel, markdownExtension, mdxFrontmatter }, function (response) {
        showResponseStatus(response);
      });
    });
  });

  currentProjectJsonButton.addEventListener('click', function () {
    setCurrentProjectBackupRunningState(true);
    progressDiv.innerHTML = 'Preparing current project JSON backup...';
    chrome.runtime.sendMessage({ message: 'backUpCurrentProject', downloadType: 'json', startOffset: 0, stopOffset: -1 }, function (response) {
      showResponseStatus(response);
    });
  });

  currentProjectRawJsonButton.addEventListener('click', function () {
    setCurrentProjectBackupRunningState(true);
    progressDiv.innerHTML = 'Preparing current project raw JSON backup...';
    chrome.runtime.sendMessage({ message: 'backUpCurrentProject', downloadType: 'raw-json', startOffset: 0, stopOffset: -1 }, function (response) {
      showResponseStatus(response);
    });
  });

  currentProjectMarkdownButton.addEventListener('click', function () {
    setCurrentProjectBackupRunningState(true);
    progressDiv.innerHTML = 'Preparing current project markdown backup...';
    chrome.runtime.sendMessage({ message: 'backUpCurrentProject', downloadType: 'markdown', startOffset: 0, stopOffset: -1, userLabel, assistantLabel, markdownExtension, mdxFrontmatter }, function (response) {
      showResponseStatus(response);
    });
  });

  stopCurrentProjectBackupButton.addEventListener('click', function () {
    progressDiv.innerHTML = 'Stopping project backup and preparing partial download...';
    chrome.runtime.sendMessage({ message: 'stopBackup' }, function (response) {
      if (chrome.runtime.lastError) {
        progressDiv.innerHTML = `Error: ${chrome.runtime.lastError.message}`;
        resetRunningStates();
        return;
      }

      if (!response?.stopping) {
        progressDiv.innerHTML = 'No backup is currently running';
        resetRunningStates();
      }
    });
  });
});

const port = chrome.runtime.connect({ name: 'progress' });
port.onMessage.addListener(function (msg) {
  const progressDiv = document.getElementById('progress');
  if (!msg.text) return;

  const countPrefix = typeof msg.total === 'number' && msg.total > 0 ? `#${msg.total}: ` : '';
  progressDiv.innerHTML = `${countPrefix}${msg.text}`;
});
