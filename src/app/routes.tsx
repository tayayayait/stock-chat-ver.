import * as React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import App from '../../App.tsx';
import DeepflowDashboard from './pages/deepflow/DeepflowDashboard';
import OrdersPage from '@/src/domains/orders/pages/OrdersPage';
import NewPurchaseOrderPage from './pages/purchase-orders/NewPurchaseOrderPage';
import PurchaseOrderDetailPage from './pages/purchase-orders/PurchaseOrderDetailPage';
import SalesOrdersPage from './pages/sales-orders/SalesOrdersPage';
import SalesOrderDetailPage from './pages/sales-orders/SalesOrderDetailPage';
import NewSalesOrderPage from './pages/sales-orders/NewSalesOrderPage';
import SmartWarehouseLayout from './layout/SmartWarehouseLayout';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        path: '',
        element: <SmartWarehouseLayout />,
        children: [
          {
            index: true,
            element: <DeepflowDashboard />,
          },
          {
            path: 'purchase-orders/new',
            element: <NewPurchaseOrderPage />,
          },
          {
            path: 'purchase-orders/drafts/:draftId/edit',
            element: <NewPurchaseOrderPage />,
          },
          {
            path: 'purchase-orders/:id',
            element: <PurchaseOrderDetailPage />,
          },
          {
            path: 'sales-orders/new',
            element: <NewSalesOrderPage />,
          },
          {
            path: 'sales-orders',
            element: <SalesOrdersPage />,
          },
          {
            path: 'sales-orders/:id',
            element: <SalesOrderDetailPage />,
          },
        ],
      },
      {
        path: 'orders',
        element: <OrdersPage />,
      },
    ],
  },
]);
