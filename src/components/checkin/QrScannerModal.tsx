import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X, Camera, CameraOff, FlipHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QrScannerModalProps {
  onScan: (value: string) => void;
  onClose: () => void;
}

export function QrScannerModal({ onScan, onClose }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const scannedRef = useRef(false); // prevent double-fire

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [scanning, setScanning] = useState(true);
  const [flashSuccess, setFlashSuccess] = useState(false);

  const stopStream = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const startCamera = async (facing: "environment" | "user") => {
    stopStream();
    scannedRef.current = false;
    setScanning(true);
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          tick();
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera unavailable";
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setCameraError("Camera permission denied. Please allow camera access in your browser settings.");
      } else if (msg.includes("NotFound")) {
        setCameraError("No camera found on this device.");
      } else {
        setCameraError(`Camera error: ${msg}`);
      }
    }
  };

  const tick = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || scannedRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });
        if (code && code.data) {
          scannedRef.current = true;
          setScanning(false);
          setFlashSuccess(true);
          stopStream();
          setTimeout(() => {
            onScan(code.data);
            onClose();
          }, 400);
          return;
        }
      }
    }
    animRef.current = requestAnimationFrame(tick);
  };

  const handleFlip = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  };

  useEffect(() => {
    startCamera(facingMode);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      {/* Container */}
      <div className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-black/60 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-white">Scan QR Code</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Camera view */}
        <div className="relative aspect-square bg-black overflow-hidden">
          {!cameraError ? (
            <>
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />

              {/* Hidden canvas for processing */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Success flash */}
              {flashSuccess && (
                <div className="absolute inset-0 bg-primary/30 animate-pulse z-10" />
              )}

              {/* Scanning frame overlay */}
              {scanning && !flashSuccess && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  {/* Dark corners */}
                  <div className="absolute inset-0 bg-black/40" />
                  {/* Scan frame */}
                  <div className="relative w-56 h-56">
                    {/* Corner brackets */}
                    {[
                      "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                      "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                      "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                      "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                    ].map((cls, i) => (
                      <div key={i} className={cn("absolute w-8 h-8 border-primary", cls)} />
                    ))}
                    {/* Scanning line */}
                    <div className="absolute inset-x-0 h-0.5 bg-primary/80 blur-sm scanner-line" />
                  </div>
                </div>
              )}

              {/* Camera flip button */}
              <button
                onClick={handleFlip}
                className="absolute bottom-3 right-3 z-20 p-2.5 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors"
              >
                <FlipHorizontal className="h-4 w-4" />
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
              <div className="p-4 rounded-full bg-white/10">
                <CameraOff className="h-8 w-8 text-white/50" />
              </div>
              <p className="text-sm text-white/70">{cameraError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startCamera(facingMode)}
                className="border-white/20 text-white hover:bg-white/10 hover:text-white"
              >
                Try Again
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 bg-black/60 text-center">
          <p className="text-xs text-white/50">
            {flashSuccess ? "QR code detected!" : scanning ? "Point camera at QR code" : "Processing..."}
          </p>
        </div>
      </div>
    </div>
  );
}
