set path=,,src/**,example

" Lean on git to save backups
set autowriteall

" search
set grepprg=git\ grep\ -n
nnoremap <Leader>g :grep<SPACE>

" build
nnoremap <Leader>b :!npm run build<CR>
nnoremap <Leader>e :!npm run example<CR>

" test
nnoremap <Leader>t :!npm run test<CR>
nnoremap <Leader>d :!./debug-spec.sh<CR>
