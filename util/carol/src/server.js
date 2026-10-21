// Ponto de entrada da Carol (npm start). A aplicação está em app.js (sem
// listen, testável) e o boot em boot.js (listen primeiro, tarefas lentas depois).
import { iniciarServico } from './boot.js';

iniciarServico();
