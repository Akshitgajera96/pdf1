interface SecurityOverlayProps {
  children: React.ReactNode;
}

export const SecurityOverlay = ({ children }: SecurityOverlayProps) => {
  return (
    <>{children}</>
  );
};
