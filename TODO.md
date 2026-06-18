download image implementation

```ts
async function getAccessToken() {
  const session = await fetch('https://chatgpt.com/api/auth/session', {
    credentials: 'include',
  }).then(r => r.json());

  return session.accessToken;
}

async function getConversation(conversationId) {
  const token = await getAccessToken();

  return fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`, {
    credentials: 'include',
    headers: {
      authorization: `Bearer ${token}`,
    },
  }).then(r => r.json());
}

function findImageFileIds(conversation) {
  const fileIds = [];

  for (const node of Object.values(conversation.mapping ?? {})) {
    const parts = node.message?.content?.parts ?? [];

    for (const part of parts) {
      if (
        part &&
        typeof part === 'object' &&
        part.content_type === 'image_asset_pointer' &&
        typeof part.asset_pointer === 'string'
      ) {
        const fileId = part.asset_pointer.replace('sediment://', '');
        fileIds.push(fileId);
      }
    }
  }

  return fileIds;
}

async function getDownloadUrl(fileId, conversationId) {
  const token = await getAccessToken();

  const url =
    `https://chatgpt.com/backend-api/files/download/${fileId}` +
    `?conversation_id=${encodeURIComponent(conversationId)}` +
    `&inline=false` +
    `&download_intent=false`;

  const data = await fetch(url, {
    credentials: 'include',
    headers: {
      authorization: `Bearer ${token}`,
    },
  }).then(r => r.json());

  if (data.status !== 'success') {
    throw new Error(`Failed to get download URL for ${fileId}`);
  }

  return data.download_url;
}

async function downloadBlob(url, filename) {
  const token = await getAccessToken();

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Image download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  a.remove();
  URL.revokeObjectURL(objectUrl);
}

async function downloadImagesFromConversation(conversationId) {
  const conversation = await getConversation(conversationId);
  const fileIds = findImageFileIds(conversation);

  console.log('Found image file IDs:', fileIds);

  for (const fileId of fileIds) {
    const downloadUrl = await getDownloadUrl(fileId, conversationId);
    await downloadBlob(downloadUrl, `${fileId}.png`);
  }
}

downloadImagesFromConversation('6a2cf71b-6180-83e8-8a3f-7fb81ca036dd');

```

 For your specific generated image, the important request is:

 ```js
   const fileId = 'file_00000000515c71f5813852acf7c22530';
   const conversationId = '6a2cf71b-6180-83e8-8a3f-7fb81ca036dd';

   const downloadUrl = await getDownloadUrl(fileId, conversationId);
   await downloadBlob(downloadUrl, `${fileId}.png`);
 ```

 What changed:
 - The ts, p, cid, sig, and v values should not be guessed.
 - You should request them from /backend-api/files/download/{file_id}.
 - The conversation JSON gives you only the file_id; the download endpoint gives you the signed estuary/content URL.
