'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /* Produtos */
  listarProdutos:   ()          => ipcRenderer.invoke('produtos:listar'),
  criarProduto:     (d)         => ipcRenderer.invoke('produtos:criar', d),
  atualizarProduto: (id, d)     => ipcRenderer.invoke('produtos:atualizar', id, d),
  deletarProduto:   (id)        => ipcRenderer.invoke('produtos:deletar', id),
  buscarPorCodigo:  (c)         => ipcRenderer.invoke('produtos:buscarPorCodigo', c),

  /* Admin */
  verificarAdmin:       (eH, sH)  => ipcRenderer.invoke('admin:verificar', eH, sH),
  adminAtualizarCusto:  (id, v)   => ipcRenderer.invoke('admin:atualizarCusto', id, v),
  adminAtualizarEstoque:(id, v)   => ipcRenderer.invoke('admin:atualizarEstoque', id, v),

  /* Vendas */
  finalizarVenda: (d)         => ipcRenderer.invoke('vendas:finalizar', d),
  vendasHoje:     ()          => ipcRenderer.invoke('vendas:hoje'),
  vendasMensais:  (m, a)      => ipcRenderer.invoke('vendas:mensais', m, a),
  lucroMensal:    (m, a)      => ipcRenderer.invoke('vendas:lucro', m, a),
  detalhesVenda:  (id)        => ipcRenderer.invoke('vendas:detalhes', id)
})
