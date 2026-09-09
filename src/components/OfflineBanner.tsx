import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff } from 'lucide-react';

export const OfflineBanner: React.FC<{ show: boolean }> = ({ show }) => (
  <AnimatePresence>
    {show && (
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-2 text-sm font-[Barlow] font-medium"
        style={{
          background: 'rgba(245,158,11,0.95)',
          color: '#0D0D0D',
          // Sits at the very top of an installed app, so it needs the same
          // clearance from the status bar the main content gets.
          paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)',
        }}
      >
        <WifiOff size={14} />
        You're offline. Some features may be unavailable.
      </motion.div>
    )}
  </AnimatePresence>
);
