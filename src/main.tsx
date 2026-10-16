import React from 'react';
import ReactDOM from 'react-dom/client';
import 'paper-ink/style.css';
import './global.less';
import './compact.less';


const root=ReactDOM.createRoot(document.getElementById('root')!);
if(new URLSearchParams(location.search).has('floating')){
  document.documentElement.classList.add('floating-window');
  document.documentElement.style.background='transparent';document.body.style.background='transparent';
  void import('./views/Floating').then(({default:Floating})=>root.render(<React.StrictMode><Floating/></React.StrictMode>));
}else{
  void import('./App').then(({default:App})=>root.render(<React.StrictMode><App/></React.StrictMode>));
}
