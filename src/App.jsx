import { useState } from 'react';
import TriangulatorApp from './components/TriangulatorApp';

const CORRECT_PASSWORD = 'przyjaciel';
function App() {
  const [inputValue, setInputValue] = useState('');
  const [passwordEntered, setPasswordEntered] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue === CORRECT_PASSWORD) {
      setPasswordEntered(true);
      setErrorMessage('');
    } else {
      setErrorMessage('Incorrect password');
      setInputValue('');
    }
  };

  if (!passwordEntered) {
    return (
      <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
        <h2>Pedo mellon a minno</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300 }}>
          <input
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Password"
            style={{ padding: '8px', fontSize: '16px' }}
          />
          <button type="submit" style={{ padding: '8px', fontSize: '16px' }}>Submit</button>
          {errorMessage && <div style={{ color: 'red', fontWeight: 'bold' }}>{errorMessage}</div>}
        </form>
   <a
        href="https://www.drivethrurpg.com/en/product/547322/create-your-own-origami-style-map-puzzle"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', marginTop: 20, fontSize: '20px' }}
      >
        Get your password here!
      </a>
      </div>
    );
  }

  // Hasło poprawne – pokazujemy główną aplikację
  return <TriangulatorApp />;
}

export default App;
