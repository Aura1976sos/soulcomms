import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, X, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ReceiptData {
  participantName: string;
  participantCode: string;
  participantPhone?: string | null;
  activityName: string;
  sessionDate: string | null;
  startTime: string;
  endTime: string;
  location: string | null;
  participationCode: string;
  generatedBy: string;
  eventName: string;
  generatedAt: string;
}

interface Props {
  data: ReceiptData;
  onClose: () => void;
  onNewParticipant?: () => void;
}

const AUTO_KEY = "sc_auto_print";

// ─── Receipt Component ────────────────────────────────────────────────────────
export function ActivityReceipt({ data, onClose, onNewParticipant }: Props) {
  // Plain participation code — smaller payload = larger QR modules = higher scan success
  const qrValue = data.participationCode;

  const [autoPrint, setAutoPrint] = useState(() => localStorage.getItem(AUTO_KEY) === "1");
  const hasFiredAutoRef = useRef(false);

  const handlePrint = () => {
    const win = window.open("", "_blank", "width=240,height=400");
    if (!win) return;

    const qrSvgEl = document.getElementById("receipt-qr-svg");
    const qrSvgHtml = qrSvgEl ? qrSvgEl.outerHTML : "";

    win.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${data.participationCode}</title>
    <style>
      @page { size: 58mm auto; margin: 0 2mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Courier New', Courier, monospace;
        background: #fff;
        color: #000;
        width: 54mm;
        padding: 4mm 1mm 3mm;
        text-align: center;
      }
      .name {
        font-size: 15pt;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        line-height: 1.1;
        margin-bottom: 3mm;
        word-break: break-word;
      }
      .code {
        font-size: 11pt;
        font-weight: 900;
        letter-spacing: 2px;
        margin-bottom: 3mm;
        font-family: 'Courier New', Courier, monospace;
      }
      .divider {
        border: none;
        border-top: 1px dashed #000;
        margin: 3mm 0;
      }
      .qr {
        display: flex;
        justify-content: center;
        align-items: center;
        margin: 2mm 0;
      }
      .qr svg {
        width: 170px !important;
        height: 170px !important;
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="name">${data.participantName}</div>
    <div class="code">${data.participationCode}</div>
    <hr class="divider" />
    <div class="qr">${qrSvgHtml}</div>
  </body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  // Auto-print on mount when setting is enabled
  useEffect(() => {
    if (autoPrint && !hasFiredAutoRef.current) {
      hasFiredAutoRef.current = true;
      const t = setTimeout(handlePrint, 600);
      return () => clearTimeout(t);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAutoPrint = () => {
    setAutoPrint(prev => {
      const next = !prev;
      localStorage.setItem(AUTO_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-xs bg-card border border-border rounded-2xl overflow-hidden shadow-2xl my-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" />
            <p className="text-sm font-black text-foreground">Activity Ticket</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Ticket preview — mirrors print output */}
        <div className="px-5 pt-5 pb-4 flex flex-col items-center gap-3">

          {/* Participant name */}
          <p className="text-xl font-black uppercase tracking-wide text-foreground text-center leading-tight">
            {data.participantName}
          </p>

          {/* Activity code */}
          <p className="text-base font-black font-mono tracking-widest text-primary text-center">
            {data.participationCode}
          </p>

          {/* Divider */}
          <div className="w-full border-t border-dashed border-border" />

          {/* QR — dominant element */}
          <div className="flex justify-center p-2">
            <QRCodeSVG
              id="receipt-qr-svg"
              value={qrValue}
              size={200}
              level="H"
              includeMargin={false}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>

          {/* Auto-print toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
            <div
              onClick={toggleAutoPrint}
              className={`relative w-8 h-4 rounded-full transition-colors ${autoPrint ? "bg-primary" : "bg-muted"}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${autoPrint ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" />
              Auto-print
            </span>
          </label>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 px-5 pb-5">
          <Button
            onClick={handlePrint}
            className="flex-1 gap-2 bg-primary text-primary-foreground shadow-glow-primary"
          >
            <Printer className="h-4 w-4" />
            Print Ticket
          </Button>
          {onNewParticipant && (
            <Button variant="outline" onClick={onNewParticipant} className="flex-1 border-border">
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
