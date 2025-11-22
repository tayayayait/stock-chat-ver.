import * as React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import ToastProvider from './src/components/Toaster';
import ChatbotWidget from './src/app/components/chatbot/ChatbotWidget';

const AppLayout: React.FC = () => {
  // 서버에서 받은 데이터를 저장할 상태 변수 선언
  const [message, setMessage] = React.useState<string>('');

  // useEffect로 서버에서 데이터를 받아옴
  React.useEffect(() => {
    // 서버 헬스 체크: 프록시/배포 환경에서도 동작하도록 상대 경로 사용
    fetch('/api/health')
      .then((response) => response.json())
      .then((data: { ok?: boolean } | undefined) => {
        if (data && (data as { ok?: boolean }).ok) {
          setMessage(''); // 표시 메시지 불필요 시 비움
        } else {
          setMessage('');
        }
      })
      .catch(() => {
        // 에러를 UI에 크게 띄우지 않고 콘솔에만 남김
        console.log('헬스 체크 실패: /api/health');
        setMessage('');
      });
  }, []); // 앱 최초 렌더링 시 한 번만 실행

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-slate-100">
        <header className="border-b border-slate-200 bg-white print:hidden">
          <div className="flex w-full items-center justify-between px-6 py-4">
            <h1 className="text-lg font-semibold text-slate-800">STOCK- Console</h1>
            <nav className="flex items-center gap-2 text-sm">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 font-semibold transition ${
                    isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`
                }
              >
                수요/재고 대시보드
              </NavLink>
              <NavLink
                to="/orders"
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 font-semibold transition ${
                    isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`
                }
              >
                주문서 관리
              </NavLink>
            </nav>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">
          {/* 서버에서 받은 데이터를 화면에 표시 */}
          <div>{message}</div> {/* message 상태에 저장된 데이터 표시 */}
          <Outlet />
        </main>
        <ChatbotWidget />
      </div>
    </ToastProvider>
  );
};

export default AppLayout;
