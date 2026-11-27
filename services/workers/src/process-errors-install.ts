// Imported first by the entry point, so the handlers exist before any queue connects.
import { installFatalErrorHandlersV1 } from "./process-errors";

installFatalErrorHandlersV1();
