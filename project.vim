set path=,,src/**,example

" build
nnoremap <Leader>b :!npm run build<CR>

" test
nnoremap <Leader>t :!npm run test<CR>
nnoremap <Leader>d :!./debug-spec.sh<CR>
