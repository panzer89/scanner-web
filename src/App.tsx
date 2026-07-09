import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Scanner from './pages/Scanner';
import Archive from './pages/Archive';
import Preview from './pages/Preview';
import Cloud from './pages/Cloud';
import CloudGuide from './pages/CloudGuide';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/scan" element={<Scanner />} />
      <Route path="/archive" element={<Archive />} />
      <Route path="/doc/:id" element={<Preview />} />
      <Route path="/cloud" element={<Cloud />} />
      <Route path="/guida" element={<CloudGuide />} />
    </Routes>
  );
}
