import type { ReactNode } from "react";

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const TasksIcon = () => (
  <Icon>
    <path d="M9 11l3 3 8-8" />
    <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
  </Icon>
);
export const ChatIcon = () => (
  <Icon>
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
  </Icon>
);
export const PlugIcon = () => (
  <Icon>
    <path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0V8zM12 17v5" />
  </Icon>
);
export const MicIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);
export const SendIcon = () => (
  <Icon>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </Icon>
);
export const SpeakerIcon = ({ off }: { off?: boolean }) => (
  <Icon>
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    {off ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon size={16}>
    <path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth="3" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const SparkIcon = () => (
  <Icon size={16}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
  </Icon>
);
export const DriveIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 3h8l6 10.4-4 6.6H6L2 13.4 8 3z" fill="#fbbc04" />
    <path d="M8 3l-6 10.4 4 6.6 6-10.4L8 3z" fill="#0f9d58" />
    <path d="M22 13.4L16 3 10 13.4h12z" fill="#4285f4" opacity=".9" />
    <path d="M6 20l4-6.6h12L18 20H6z" fill="#ea4335" opacity=".85" />
  </svg>
);
