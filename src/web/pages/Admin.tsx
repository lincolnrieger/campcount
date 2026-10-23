import { Link } from 'react-router';

export function Admin() {
  return (
    <>
      <div className="page-head">
        <h1>Admin</h1>
      </div>
      <ul className="launch">
        <li>
          <Link to="/admin/users">
            People <span>Accounts and administrators</span>
          </Link>
        </li>
        <li>
          <Link to="/admin/demo">
            Demo mode <span>Practice camps with made-up people</span>
          </Link>
        </li>
      </ul>
    </>
  );
}
