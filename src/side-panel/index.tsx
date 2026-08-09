// Side panel React entry point
// Full UI implementation in Task 11

import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <div>CourseChat</div>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);
