import { methods, readBody } from '../lib/http.js';
import { sendInvoice } from '../lib/invoice-service.js';

export default methods({ POST: (req) => sendInvoice(readBody(req)) });
