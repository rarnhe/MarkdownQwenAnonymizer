/** Strict four-category JSON GBNF for llama.cpp / llama-server. */
export const ENTITY_GBNF_GRAMMAR = String.raw`root ::= "{" space "\"persons\"" space ":" space string-array "," space "\"organizations\"" space ":" space string-array "," space "\"id_cards\"" space ":" space string-array "," space "\"codes\"" space ":" space string-array "}"
string-array ::= "[" space (string ("," space string)*)? space "]"
string ::= "\"" [^"\\]* "\""
space ::= [ \t\n\r]*`;
