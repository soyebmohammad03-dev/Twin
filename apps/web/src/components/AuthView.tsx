import React, { useState } from 'react';
import { motion } from 'motion/react';
import { SignInView } from './SignInView';
import { SignUpView } from './SignUpView';

export const AuthView: React.FC = () => {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  return (
    <div className="min-h-screen w-full flex flex-col justify-center">
      {authMode === 'signin' ? (
        <motion.div
          key="signin-view"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full flex items-center justify-center"
        >
          <SignInView onNavigateToSignUp={() => setAuthMode('signup')} />
        </motion.div>
      ) : (
        <motion.div
          key="signup-view"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full flex items-center justify-center"
        >
          <SignUpView onNavigateToSignIn={() => setAuthMode('signin')} />
        </motion.div>
      )}
    </div>
  );
};
