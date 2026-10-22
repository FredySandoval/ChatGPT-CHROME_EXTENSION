import { useEffect, useState } from 'react';

const hiddenKey = 'hideExportSuccessMessage';
const visitedKey = 'supportLinkVisited';

export function useSupportPreferences() {
  const [hidden, setHidden] = useState(false);
  const [visited, setVisited] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get([hiddenKey, visitedKey], (result) => {
      setHidden(result[hiddenKey] === true);
      setVisited(result[visitedKey] === true);
      setLoaded(true);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[hiddenKey]) setHidden(changes[hiddenKey].newValue === true);
      if (changes[visitedKey]) setVisited(changes[visitedKey].newValue === true);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return {
    hidden, visited, loaded,
    setHidden: (value: boolean) => {
      setHidden(value);
      void chrome.storage.local.set({ [hiddenKey]: value });
    },
    markVisited: () => {
      setVisited(true);
      void chrome.storage.local.set({ [visitedKey]: true });
    },
  };
}

export function SupportProject({ onVisit }: { onVisit: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <a onClick={onVisit} className="mt-3 inline-flex items-center justify-center rounded-[7px] border-2 border-[#9FE3D5] bg-white px-4 py-2 font-medium text-[#215145] hover:bg-[#C6F0E5]" href="https://buymeacoffee.com/shockerovi7" target="_blank" rel="noopener noreferrer">
        ☕ Buy Me a Coffee
      </a>
      <img src="/images/buy-me-a-coffee-qr.png" width={144} height={144} alt="QR code linking to Buy Me a Coffee for shockerovi7" className="rounded-md bg-white" />
      <p className="text-sm">Scan to support from your phone.</p>
    </div>
  );
}
