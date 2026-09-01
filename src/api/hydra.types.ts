/**
 * The collection envelope API Platform wraps every list response in.
 *
 * It belongs to the client runtime rather than to any one screen: it is the
 * shape of EVERY paginated response the CoolMS API emits, so a feature that
 * lists anything needs it, and a UI kit that lists anything must not have to
 * reach into the application to describe it.
 *
 * **The keys arrive WITHOUT the `hydra:` prefix.** The vocabulary is mapped in
 * `@context`, so the wire carries `member` and `totalItems` rather than
 * `hydra:member` and `hydra:totalItems`.
 *
 *  Three document services in the admin declare their own version of this
 * interface accepting BOTH spellings, every field optional. That is a
 * different claim about the same wire, not a duplicate of this one, and
 * whichever is wrong is wrong silently -- an optional `member` makes every
 * call site handle an absence that may never happen, and a required one
 * crashes if it does. Settle it by calling the endpoint, not by merging the
 * types.
 */
export interface HydraView {
    '@id':       string;
    'next'?:     string;
    'previous'?: string;
    'last'?:     string;
}

export interface HydraCollection<T> {
    'member':     T[];
    'totalItems': number;
    'view'?:      HydraView;
}
