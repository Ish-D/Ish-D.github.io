import React from 'react';
import RectangleEditor from './components/RectangleEditor';

function App() {
  return (
    <div className="min-h-screen bg-white-50 p-8">
      <div className="max-w-6xl mx-auto">

        <div className="bg-wb rounded-lg shadow-lg overflow-hidden">
          <RectangleEditor />
        </div>
      </div>
    </div>
  );
}

export default App;