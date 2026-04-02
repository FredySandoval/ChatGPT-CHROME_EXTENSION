const DEFAULT_USER_LABEL = '<img src="https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png" width="24" alt="User" />';
const DEFAULT_ASSISTANT_LABEL = '<img src="https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg" width="24" alt="Assistant" />';

document.addEventListener('DOMContentLoaded', () => {
  // Load stored values and populate input fields
  chrome.storage.sync.get(['startOffset', 'stopOffset', 'userLabel', 'assistantLabel'], (result) => {
    const startOffset = result.startOffset || 0;
    const stopOffset = result.stopOffset || -1;
    const userLabel = result.userLabel || DEFAULT_USER_LABEL;
    const assistantLabel = result.assistantLabel || DEFAULT_ASSISTANT_LABEL;

    document.querySelector('#startOffset').value = startOffset;
    document.querySelector('#stopOffset').value = stopOffset;
    document.querySelector('#user').value = userLabel;
    document.querySelector('#assistant').value = assistantLabel;
  });
});


document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();

  const startOffset = document.querySelector('#startOffset').value;
  chrome.storage.sync.set({ startOffset: startOffset }, () => {
    console.log('startOffset saved:', startOffset);
  });

  const stopOffset = document.querySelector('#stopOffset').value;
  chrome.storage.sync.set({ stopOffset: stopOffset }, () => {
    console.log('stopOffset saved:', stopOffset);
  });

  const userLabel = document.querySelector('#user').value || DEFAULT_USER_LABEL;
  chrome.storage.sync.set({ userLabel: userLabel }, () => {
    console.log('userLabel saved:', userLabel);
  });

  const assistantLabel = document.querySelector('#assistant').value || DEFAULT_ASSISTANT_LABEL;
  chrome.storage.sync.set({ assistantLabel: assistantLabel }, () => {
    console.log('assistantLabel saved:', assistantLabel);
  });

});