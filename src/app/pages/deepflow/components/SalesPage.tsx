import * as React from 'react';
import SalesOrdersPage from '@/src/app/pages/sales-orders/SalesOrdersPage';

// Thin wrapper: reuse the new sales orders page in the Deepflow tab view
const SalesPage: React.FC = () => {
  return <SalesOrdersPage />;
};

export default SalesPage;
