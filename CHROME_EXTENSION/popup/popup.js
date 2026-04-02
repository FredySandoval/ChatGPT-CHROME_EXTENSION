document.addEventListener('DOMContentLoaded', function () {
  const progressDiv = document.getElementById('progress');
  const allJsonButton = document.getElementById('download-as-json');
  const allRawJsonButton = document.getElementById('download-as-raw-json');
  const allMarkdownButton = document.getElementById('download-as-markdown');
  const stopAllBackupButton = document.getElementById('stop-all-backup');

  function setAllBackupRunningState(isRunning) {
    allJsonButton.classList.toggle('hidden', isRunning);
    allRawJsonButton.classList.toggle('hidden', isRunning);
    allMarkdownButton.classList.toggle('hidden', isRunning);
    stopAllBackupButton.classList.toggle('hidden', !isRunning);
  }

  function showResponseStatus(response, fallbackSuccessText = 'Download complete') {
    if (chrome.runtime.lastError) {
      progressDiv.innerHTML = `Error: ${chrome.runtime.lastError.message}`;
      setAllBackupRunningState(false);
      return;
    }

    if (!response) {
      progressDiv.innerHTML = fallbackSuccessText;
      setAllBackupRunningState(false);
      return;
    }

    if (response.cancelled) {
      progressDiv.innerHTML = `Stopped and downloaded ${response.conversations?.length || response.rawConversations?.length || 0} chats${response.failures?.length ? `, skipped ${response.failures.length}` : ''}`;
      setAllBackupRunningState(false);
      return;
    }

    if (response.error) {
      progressDiv.innerHTML = `Error: ${response.error}`;
      setAllBackupRunningState(false);
      return;
    }

    if (response.failures?.length) {
      progressDiv.innerHTML = `Done: ${response.conversations?.length || response.rawConversations?.length || 0} chats, skipped ${response.failures.length}`;
      setAllBackupRunningState(false);
      return;
    }

    progressDiv.innerHTML = fallbackSuccessText;
    setAllBackupRunningState(false);
  }

  chrome.storage.local.get(['colorScheme'], function (result) {
    const container = document.querySelector('.extension-container');
    container.classList.add(result.colorScheme);
    console.log('popup.js colorScheme', result);
  });

  const defaultUserLabel = '<img src="https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png" width="24" alt="User" />';
  const defaultAssistantLabel = '<img src="https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg" width="24" alt="Assistant" />';
  let userLabel = defaultUserLabel;
  let assistantLabel = defaultAssistantLabel;

  chrome.storage.sync.get(['startOffset', 'stopOffset', 'userLabel', 'assistantLabel'], function (result) {
    const startOffset = Number(result.startOffset ?? 0);
    const stopOffset = Number(result.stopOffset ?? -1);
    userLabel = result.userLabel || defaultUserLabel;
    assistantLabel = result.assistantLabel || defaultAssistantLabel;

    allJsonButton.addEventListener('click', function () {
      setAllBackupRunningState(true);
      progressDiv.innerHTML = 'Fetching chats for JSON backup...';
      chrome.runtime.sendMessage({ message: 'backUpAllAsJSON', startOffset, stopOffset }, function (response) {
        showResponseStatus(response);
      });
    });

    allRawJsonButton.addEventListener('click', function () {
      setAllBackupRunningState(true);
      progressDiv.innerHTML = 'Fetching chats for raw JSON backup...';
      chrome.runtime.sendMessage({ message: 'backUpAllAsRAWJSON', startOffset, stopOffset }, function (response) {
        showResponseStatus(response);
      });
    });

    allMarkdownButton.addEventListener('click', function () {
      setAllBackupRunningState(true);
      progressDiv.innerHTML = 'Fetching chats for markdown backup...';
      chrome.runtime.sendMessage({ message: 'backUpAllAsMARKDOWN', startOffset, stopOffset, userLabel, assistantLabel }, function (response) {
        showResponseStatus(response);
      });
    });
  });

  stopAllBackupButton.addEventListener('click', function () {
    progressDiv.innerHTML = 'Stopping backup and preparing partial download...';
    chrome.runtime.sendMessage({ message: 'stopBackup' }, function (response) {
      if (chrome.runtime.lastError) {
        progressDiv.innerHTML = `Error: ${chrome.runtime.lastError.message}`;
        setAllBackupRunningState(false);
        return;
      }

      if (!response?.stopping) {
        progressDiv.innerHTML = 'No backup is currently running';
        setAllBackupRunningState(false);
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
      chrome.runtime.sendMessage({ message: 'backUpSingleChat', tabs, downloadType: 'markdown', userLabel, assistantLabel }, function (response) {
        showResponseStatus(response);
      });
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
