'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /* Produtos */
  listarProdutos:   ()          => ipcRenderer.invoke('produtos:listar'),
  criarProduto:     (dados)     => ipcRenderer.invoke('produtos:criar',    dados),
  atualizarProduto: (id, dados) => ipcRenderer.invoke('produtos:atualizar', id, dados),
  deletarProduto:   (id)        => ipcRenderer.invoke('produtos:deletar',  id),
  buscarPorCodigo:  (codigo)    => ipcRenderer.invoke('produtos:buscarPorCodigo', codigo),

  /* Vendas */
  finalizarVenda: (dados)       => ipcRenderer.invoke('vendas:finalizar', dados),
  vendasHoje:     ()            => ipcRenderer.invoke('vendas:hoje'),
  vendasMensais:  (mes, ano)    => ipcRenderer.invoke('vendas:mensais',   mes, ano),
  lucroMensal:    (mes, ano)    => ipcRenderer.invoke('vendas:lucro',     mes, ano),
  detalhesVenda:  (id)          => ipcRenderer.invoke('vendas:detalhes',  id)
})
