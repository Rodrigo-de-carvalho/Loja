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
  adminLogin:           (eH, sH)  => ipcRenderer.invoke('admin:login', eH, sH),
  adminLogout:          ()        => ipcRenderer.invoke('admin:logout'),
  adminAtualizarCusto:  (id, v)   => ipcRenderer.invoke('admin:atualizarCusto', id, v),
  adminAtualizarEstoque:(id, v)   => ipcRenderer.invoke('admin:atualizarEstoque', id, v),
  getTaxas:             ()        => ipcRenderer.invoke('admin:getTaxas'),
  salvarTaxas:          (t)       => ipcRenderer.invoke('admin:salvarTaxas', t),

  /* Vendas */
  finalizarVenda:    (d)      => ipcRenderer.invoke('vendas:finalizar', d),
  trocaInfo:         (id)     => ipcRenderer.invoke('vendas:trocaInfo', id),
  cancelarVenda:     (id)     => ipcRenderer.invoke('vendas:cancelar', id),
  vendasHoje:        ()       => ipcRenderer.invoke('vendas:hoje'),
  vendasMensais:     (m, a)   => ipcRenderer.invoke('vendas:mensais', m, a),
  vendasPeriodo:     (i, f)   => ipcRenderer.invoke('vendas:periodo', i, f),
  estornadasMensais: (m, a)   => ipcRenderer.invoke('vendas:estornadas', m, a),
  lucroMensal:       (m, a)   => ipcRenderer.invoke('vendas:lucro', m, a),
  detalhesVenda:     (id)     => ipcRenderer.invoke('vendas:detalhes', id)
})
