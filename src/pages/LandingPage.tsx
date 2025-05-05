import React from 'react';
import { Link } from 'react-router-dom';

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-2xl text-center space-y-8">
        <h1 className="text-5xl font-bold">AI Math Tutor</h1>
        <p className="text-xl text-gray-300">
          Get instant help with your math problems using our AI-powered tutor.
          Upload images, ask questions, and get step-by-step explanations.
        </p>
        <div className="pt-8">
          <Link
            to="/chat"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-200"
          >
            Start Chatting
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LandingPage; 