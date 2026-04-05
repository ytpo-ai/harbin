# 修改密码前端 UI 计划

## 需求背景

后端 `POST /auth/change-password` API 和前端 `authService.changePassword()` 已完整实现，但缺少前端 UI 入口，用户无法在界面上操作修改密码。

## 现状

- 后端：`auth.controller.ts` 已有 `POST /auth/change-password`（旧密码 + 新密码）
- 前端 Service：`authService.ts` 已有 `changePassword(oldPassword, newPassword)`
- 前端 UI：**缺失**，用户下拉菜单无入口，无修改密码弹窗

## 实施步骤

1. **在 Layout.tsx 用户下拉菜单中添加"修改密码"按钮**
   - 位置：在"复制 Token"和"绑定飞书"之间
   - 点击后打开修改密码模态框

2. **添加修改密码模态框**
   - 旧密码输入框
   - 新密码输入框
   - 确认新密码输入框
   - 密码强度提示（至少 6 位，与注册页保持一致）
   - 提交/取消按钮，带 loading 状态
   - 成功/错误反馈提示

3. **前端校验**
   - 新密码至少 6 位
   - 新密码与确认密码一致
   - 旧密码不可为空

## 影响范围

- **前端**：`frontend/src/components/Layout.tsx`（仅此一个文件）
- **后端**：无变更
- **API**：无变更
- **数据库**：无变更

## 风格一致性

复用飞书绑定弹窗的模态框样式（`z-[66]`、`bg-black/30`、圆角白色卡片），保持视觉统一。
