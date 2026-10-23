import { useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { emailDraft } from '@/lib/feedback';

export function Feedback({ report, error = false }: { report: string; error?: boolean }) {
  const [working, setWorking] = useState(false);

  async function compose() {
    setWorking(true);
    const subject = `[ChatGPT Backup] ${error ? 'Bug' : 'Feedback'}`;
    const body = error ? report : 'Your feedback:\n\n';
    if (error) {
      try {
        await navigator.clipboard.writeText(body);
      } catch {
        // The report is also prefilled in the email when clipboard access fails.
      }
    }
    try {
      window.location.href = emailDraft(subject, body, error ? 'bugs' : 'feedback');
    } finally {
      setWorking(false);
    }
  }

  return <button type="button" className="inline-flex cursor-pointer items-center gap-[8px] text-[14px] text-[#00A582]" onClick={() => void compose()} disabled={working} title={error ? 'Copy technical report and open an email draft' : 'Open a feedback email draft'}>
    {error && <Copy size={14} />}<Mail size={14} />{error ? 'Report a problem' : 'Feedback'}
  </button>;
}
