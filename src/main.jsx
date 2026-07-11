import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// No <StrictMode> wrapper: it deliberately runs data fetching twice
// while developing, which doubles our CoinGecko requests — and their
// free service only tolerates ~5 per minute.
createRoot(document.getElementById('root')).render(<App />)
