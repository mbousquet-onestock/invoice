import { postHandler } from '../lib/http.js';
import { sendInvoice } from '../lib/invoice-service.js';

export default postHandler(sendInvoice);
