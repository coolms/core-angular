import { Injectable } from '@angular/core';
import { refusalWords } from './problem-words';

/**
 * Converts any caught error into the sentence a person reads: a declared problem's detail as the server gives it, a
 * validation refusal's first field message, and the one generic sentence for anything else (see refusalWords).
 */
@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {
    humanize(err: unknown): string {
        return refusalWords(err);
    }
}
