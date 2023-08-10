set path=,,src/**,example

" build
nnoremap <Leader>b :!npm run build<CR>
nnoremap <Leader>e :!npm run example<CR>

" test
nnoremap <Leader>t :!npm run test<CR>
nnoremap <Leader>d :!./debug-spec.sh<CR>
