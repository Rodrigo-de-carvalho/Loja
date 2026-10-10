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
  adminLogin:            (email, senha) => ipcRenderer.invoke('admin:login', email, senha),
  adminLogout:           ()             => ipcRenderer.invoke('admin:logout'),
  adminAlterarSenha:     (atual, nova)  => ipcRenderer.invoke('admin:alterarSenha', atual, nova),
  adminAtualizarCusto:   (id, v)        => ipcRenderer.invoke('admin:atualizarCusto', id, v),
  adminAtualizarEstoque: (id, v)        => ipcRenderer.invoke('admin:atualizarEstoque', id, v),
  adminLucro:            (m, a)         => ipcRenderer.invoke('admin:lucro', m, a),
  adminEstornar:         (id)           => ipcRenderer.invoke('admin:estornar', id),
  adminBackup:           ()             => ipcRenderer.invoke('admin:backup'),
  adminListarBackups:    ()             => ipcRenderer.invoke('admin:listarBackups'),
  adminAbrirPastaBackups:()             => ipcRenderer.invoke('admin:abrirPastaBackups'),

  /* Vendas */
  finalizarVenda:     (d)    => ipcRenderer.invoke('vendas:finalizar', d),
  proximoNumeroVenda: ()     => ipcRenderer.invoke('vendas:proximoNumero'),
  vendasHoje:         ()     => ipcRenderer.invoke('vendas:hoje'),
  vendasMensais:      (m, a) => ipcRenderer.invoke('vendas:mensais', m, a),
  maisVendidos:       (m, a) => ipcRenderer.invoke('vendas:maisVendidos', m, a),
  detalhesVenda:      (id)   => ipcRenderer.invoke('vendas:detalhes', id)
})
